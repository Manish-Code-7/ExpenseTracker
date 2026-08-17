import { extractMerchant } from "@/lib/matching";

/**
 * Reading a bank statement CSV.
 *
 * There is no standard here — every Indian bank exports a different shape, and
 * most bury the real header a few rows down under a bank name and address. So
 * rather than asking the user to map columns, this finds the header row by
 * looking for one that contains a date-ish and an amount-ish column, then
 * matches columns by the words banks actually use.
 *
 * Two amount conventions are handled:
 *   - separate Debit / Withdrawal and Credit / Deposit columns (most Indian banks)
 *   - one signed Amount column (negative meaning money out)
 */

export type ParsedRow = {
  /** 1-based line in the file, so errors can point at it. */
  line: number;
  date: string;
  amount: number;
  /** true when money left the account. */
  outgoing: boolean;
  description: string;
  merchant: string;
  reference: string | null;
  raw: string;
};

export type ParseResult = {
  rows: ParsedRow[];
  /** Rows we could not read, with the reason — surfaced, never silently dropped. */
  skipped: { line: number; reason: string; raw: string }[];
  headerLine: number;
};

const DATE_HEADERS = ["date", "txn date", "transaction date", "value date", "posting date"];
const DESC_HEADERS = ["description", "narration", "particulars", "details", "remarks", "transaction"];
const DEBIT_HEADERS = ["debit", "withdrawal", "withdrawal amt", "dr", "debit amount", "withdrawals"];
const CREDIT_HEADERS = ["credit", "deposit", "deposit amt", "cr", "credit amount", "deposits"];
const AMOUNT_HEADERS = ["amount", "amt", "transaction amount"];
const REF_HEADERS = ["ref no", "reference", "ref", "cheque no", "chq no", "utr", "transaction id"];

/** Split one CSV line, honouring quoted fields containing commas. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // "" inside a quoted field is a literal quote.
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if ((ch === "," || ch === "\t") && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

const clean = (s: string) => s.replace(/^["']|["']$/g, "").trim().toLowerCase();

function findColumn(headers: string[], names: string[]): number {
  // Exact match first, so "debit" doesn't lose to "debit card number".
  const exact = headers.findIndex((h) => names.includes(h));
  if (exact >= 0) return exact;
  return headers.findIndex((h) => names.some((n) => h.includes(n)));
}

/** Indian formats: dd/mm/yyyy, dd-mm-yy, yyyy-mm-dd, dd-Mon-yyyy. */
export function parseStatementDate(value: string): string | null {
  const v = value.replace(/^["']|["']$/g, "").trim();
  if (!v) return null;

  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const months: Record<string, string> = {
    jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
    jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
  };
  const named = v.match(/^(\d{1,2})[-/\s]([a-zA-Z]{3})[a-zA-Z]*[-/\s](\d{2,4})/);
  if (named) {
    const m = months[named[2].toLowerCase()];
    if (m) return `${fullYear(named[3])}-${m}-${named[1].padStart(2, "0")}`;
  }

  // Ambiguous d/m/y vs m/d/y: Indian statements are day-first.
  const numeric = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (numeric) {
    const [, d, m, y] = numeric;
    if (Number(m) > 12) return null;
    return `${fullYear(y)}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

const fullYear = (y: string) => (y.length === 4 ? y : Number(y) > 70 ? `19${y}` : `20${y}`);

/** "1,234.56", "1234.56 Dr", "(1,234.56)" → 1234.56. Returns null if empty. */
export function parseStatementAmount(value: string): number | null {
  const v = value.replace(/^["']|["']$/g, "").trim();
  if (!v || v === "-") return null;
  const negative = /^\(.*\)$/.test(v) || /\bdr\b/i.test(v) || v.startsWith("-");
  const digits = v.replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isFinite(n) || n === 0) return null;
  return negative ? -n : n;
}

export function parseStatementCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/);
  const skipped: ParseResult["skipped"] = [];

  // Find the header: the first row naming both a date and some amount column.
  let headerIndex = -1;
  let headers: string[] = [];
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const cells = splitCsvLine(lines[i]).map(clean);
    if (cells.length < 3) continue;
    const hasDate = findColumn(cells, DATE_HEADERS) >= 0;
    const hasMoney =
      findColumn(cells, DEBIT_HEADERS) >= 0 ||
      findColumn(cells, CREDIT_HEADERS) >= 0 ||
      findColumn(cells, AMOUNT_HEADERS) >= 0;
    if (hasDate && hasMoney) { headerIndex = i; headers = cells; break; }
  }

  if (headerIndex === -1) {
    return {
      rows: [],
      skipped: [{ line: 0, reason: "Could not find a header row with a date and an amount column.", raw: "" }],
      headerLine: -1,
    };
  }

  const col = {
    date: findColumn(headers, DATE_HEADERS),
    desc: findColumn(headers, DESC_HEADERS),
    debit: findColumn(headers, DEBIT_HEADERS),
    credit: findColumn(headers, CREDIT_HEADERS),
    amount: findColumn(headers, AMOUNT_HEADERS),
    ref: findColumn(headers, REF_HEADERS),
  };

  const rows: ParsedRow[] = [];

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;

    const cells = splitCsvLine(raw);
    const at = (idx: number) => (idx >= 0 && idx < cells.length ? cells[idx] : "");

    const date = parseStatementDate(at(col.date));
    if (!date) {
      // Statements end with totals and disclaimers; those aren't errors.
      const looksLikeData = cells.some((c) => /\d/.test(c));
      if (looksLikeData) skipped.push({ line: i + 1, reason: "No readable date", raw });
      continue;
    }

    const debit = col.debit >= 0 ? parseStatementAmount(at(col.debit)) : null;
    const credit = col.credit >= 0 ? parseStatementAmount(at(col.credit)) : null;
    const signed = col.amount >= 0 ? parseStatementAmount(at(col.amount)) : null;

    let amount: number | null = null;
    let outgoing = true;
    if (debit) { amount = Math.abs(debit); outgoing = true; }
    else if (credit) { amount = Math.abs(credit); outgoing = false; }
    else if (signed) { amount = Math.abs(signed); outgoing = signed < 0; }

    if (!amount) {
      skipped.push({ line: i + 1, reason: "No readable amount", raw });
      continue;
    }

    const description = at(col.desc) || cells.filter(Boolean).join(" ");
    rows.push({
      line: i + 1,
      date,
      amount: Math.round(amount * 100) / 100,
      outgoing,
      description,
      merchant: extractMerchant(description),
      reference: col.ref >= 0 ? at(col.ref) || null : null,
      raw,
    });
  }

  return { rows, skipped, headerLine: headerIndex + 1 };
}
