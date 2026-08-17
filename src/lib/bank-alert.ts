import { extractMerchant } from "@/lib/matching";
import { parseAmount } from "@/lib/ranges";

/**
 * Reading a bank's transaction alert.
 *
 * These arrive as SMS and email in a handful of near-identical shapes:
 * "Rs.500.00 debited from a/c XX4321 on 17-08-26 to SWIGGY". Rules handle the
 * common forms deterministically — no cost, no latency, no model needed for
 * the 90% case — and anything unrecognised is left for the assistant to read.
 *
 * Shared by both sources, since a bank's SMS and its email say the same thing
 * in the same words.
 */

export type AlertRecord = {
  amount: number;
  outgoing: boolean;
  merchant: string;
  date: string | null;
  /** Last four of the account or card mentioned, when the alert says. */
  last4: string | null;
  description: string;
};

/** Words that mean money left, and money arrived. */
const OUT = /\b(debited|debit|spent|withdrawn|paid|purchase|deducted|sent)\b/i;
const IN = /\b(credited|credit|received|deposited|refund(?:ed)?|reversal)\b/i;

/**
 * Amount, as banks write it: "Rs.500.00", "INR 1,234.56", "₹2,499".
 * Deliberately anchored to a currency marker — an alert is full of other
 * numbers (account digits, dates, reference ids) and grabbing the first one
 * would be wrong more often than right.
 */
const AMOUNT = /(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;

/** "a/c XX4321", "card ending 4321", "A/c no. XXXXXX1234". */
const LAST4 = /(?:a\/c|acct|account|card)\D{0,20}?(\d{4})\b/i;

/** Dates as alerts write them: 17-08-26, 17/08/2026, 17-Aug-26. */
const DATE =
  /\b(\d{1,2})[-/](\d{1,2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-/](\d{2,4})\b/i;

const MONTHS: Record<string, string> = {
  jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
  jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
};

function parseAlertDate(text: string): string | null {
  const m = text.match(DATE);
  if (!m) return null;
  const [, d, rawMonth, rawYear] = m;

  const month = /^\d+$/.test(rawMonth)
    ? rawMonth.padStart(2, "0")
    : MONTHS[rawMonth.toLowerCase().slice(0, 3)];
  if (!month || Number(month) > 12) return null;

  const year = rawYear.length === 4 ? rawYear : `20${rawYear}`;
  return `${year}-${month}-${d.padStart(2, "0")}`;
}

/**
 * The merchant, from the phrasing banks actually use.
 * "to SWIGGY", "at AMAZON", "towards RENT", "VPA swiggy@ybl".
 */
function findMerchant(text: string): string {
  const patterns = [
    /\b(?:to|at|towards|favou?ring)\s+([A-Za-z0-9][A-Za-z0-9 .*&'@-]{2,40}?)(?=\s+(?:on|for|ref|upi|a\/c|dated|avl|available|info)\b|[.;,\n]|$)/i,
    /\bvpa\s+([a-z0-9._-]+@[a-z]+)/i,
    /\binfo[:\s]+([A-Za-z0-9][A-Za-z0-9 .*&'-]{2,40})/i,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const cleaned = extractMerchant(m[1]);
      if (cleaned) return cleaned;
    }
  }
  return "";
}

/**
 * Read one alert. Returns null when the text is not a transaction alert or is
 * too ambiguous to trust — the caller can then fall back to the assistant
 * rather than guessing a number onto someone's ledger.
 */
export function parseBankAlert(text: string): AlertRecord | null {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;

  const amountMatch = flat.match(AMOUNT);
  if (!amountMatch) return null;

  const amount = parseAmount(amountMatch[1]);
  if (!amount || amount <= 0) return null;

  const out = OUT.test(flat);
  const inward = IN.test(flat);
  // Both or neither means the direction is genuinely unclear; refuse rather
  // than coin-flip, because getting this backwards inverts the books.
  if (out === inward) return null;

  return {
    amount,
    outgoing: out,
    merchant: findMerchant(flat),
    date: parseAlertDate(flat),
    last4: flat.match(LAST4)?.[1] ?? null,
    description: flat.slice(0, 300),
  };
}

/** True when the text looks like a balance summary or OTP rather than a spend. */
export function isNotATransaction(text: string): boolean {
  return /\b(otp|one time password|is your verification|avl bal|available balance is|statement is ready|due date|minimum amount due)\b/i.test(
    text,
  ) && !OUT.test(text) && !IN.test(text);
}
