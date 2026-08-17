import { createHash } from "node:crypto";
import { daysBetween } from "@/lib/dates";
import { round2, type TransactionType } from "@/lib/financial";

/**
 * Deciding whether an imported row is something the ledger already knows about.
 *
 * There are two different problems here, and conflating them is what makes
 * naive importers duplicate everything:
 *
 *   1. The same statement imported twice. Deterministic — the row hashes to
 *      the same fingerprint, so we skip it outright. No guessing.
 *
 *   2. A statement row against a transaction the user typed in by hand. There
 *      is no shared identifier, so this is a judgement call scored on the facts
 *      the user did enter: account, amount, date, merchant.
 *
 * The user is never asked for a reference number. When (2) finds a match we
 * write the bank's reference onto their manual row, so the *next* import of
 * that transaction resolves through (1) instead. The ledger sharpens itself
 * as it is used.
 */

/* --- 1. fingerprints: exact, cheap, idempotent --------------------------- */

/**
 * Stable identity for a statement row. Deliberately built from what a bank
 * reliably reports — a row that differs only in whitespace or case is the same
 * row, but a different amount or date is not.
 */
export function fingerprint(input: {
  accountId: string;
  date: string;
  amount: number;
  description: string;
  /** The bank's own reference, when the export includes one. */
  reference?: string | null;
}): string {
  // A real bank reference is authoritative; fall back to the row's content.
  const identity = input.reference?.trim()
    ? `ref:${input.reference.trim().toLowerCase()}`
    : `row:${normalise(input.description)}`;

  return createHash("sha256")
    .update([input.accountId, input.date, input.amount.toFixed(2), identity].join("|"))
    .digest("hex")
    .slice(0, 32);
}

/* --- 2. fuzzy matching: for rows the user already entered by hand -------- */

export type Candidate = {
  /** Row from the statement. */
  id: string;
  accountId: string;
  date: string;
  amount: number;
  merchant: string;
  type: TransactionType;
};

export type Existing = {
  id: string;
  accountId: string | null;
  date: string;
  amount: number;
  merchant: string;
  type: TransactionType;
  /**
   * Already carries a bank reference from some earlier import.
   *
   * Not a reason to skip it: the same spend can reach us from two sources —
   * a card alert by email on the day, then the statement a month later — and
   * those carry different references, so the statement row must still be able
   * to recognise the transaction the email created. It only makes the row a
   * slightly weaker candidate than an untouched manual entry.
   */
  hasReference: boolean;
};

export type Match = {
  candidateId: string;
  existingId: string;
  score: number;
  reason: string;
};

/** Settlement lag: you pay on Monday, the bank posts it on Wednesday. */
const DATE_WINDOW_DAYS = 3;

/** Below this we treat it as "probably unrelated" and import as new. */
const MIN_SCORE = 0.5;

/**
 * How alike two merchant strings are, 0..1.
 *
 * Bank descriptions are noisy — "SWIGGY*BLR UPI/8842217" versus the user's
 * "Swiggy" — so this asks whether one contains the other's significant words
 * rather than comparing them character by character.
 */
export function merchantSimilarity(a: string, b: string): number {
  const x = normalise(a);
  const y = normalise(b);
  if (!x || !y) return 0;
  if (x === y) return 1;

  const wordsOf = (s: string) =>
    s.split(" ").filter((w) => w.length >= 3 && !NOISE.has(w));

  const wa = wordsOf(x);
  const wb = wordsOf(y);
  if (wa.length === 0 || wb.length === 0) {
    // Nothing meaningful to compare; substring is the last resort.
    return x.includes(y) || y.includes(x) ? 0.6 : 0;
  }

  const shared = wa.filter((w) => wb.some((o) => o.includes(w) || w.includes(o)));
  return shared.length / Math.min(wa.length, wb.length);
}

/**
 * Score one statement row against one existing transaction.
 *
 * Account and amount are gates, not weights: money is exact, and a payment
 * from a different account is a different payment. Only date and merchant are
 * scored, because only they are genuinely uncertain.
 */
export function scorePair(candidate: Candidate, existing: Existing): Match | null {
  if (candidate.type !== existing.type) return null;
  if (existing.accountId !== candidate.accountId) return null;
  if (round2(existing.amount) !== round2(candidate.amount)) return null;

  const drift = Math.abs(daysBetween(existing.date, candidate.date));
  if (drift > DATE_WINDOW_DAYS) return null;

  // Same day is the strongest signal; confidence decays across the window.
  const dateScore = 1 - drift / (DATE_WINDOW_DAYS + 1);
  const merchantScore = merchantSimilarity(candidate.merchant, existing.merchant);

  // Weighted toward date: an exact amount on the right day is already
  // compelling, and bank descriptions are too noisy to lean on merchant.
  // A row that already came from an import is a slightly weaker candidate than
  // one the user typed, so when both fit, the manual entry is claimed first.
  const base = dateScore * 0.6 + merchantScore * 0.4;
  const score = round2(existing.hasReference ? base * 0.95 : base);
  if (score < MIN_SCORE) return null;

  const reason =
    drift === 0
      ? merchantScore > 0.5
        ? "same amount, same day, same merchant"
        : "same amount on the same day"
      : `same amount, ${drift} day${drift === 1 ? "" : "s"} apart`;

  return { candidateId: candidate.id, existingId: existing.id, score, reason };
}

/**
 * Pair statement rows to existing transactions, one to one.
 *
 * The one-to-one part matters. Buy lunch at the same place twice in a week for
 * the same amount and a naive matcher says "both rows match, skip both" — so
 * the second purchase silently never gets imported. Here each existing
 * transaction can be claimed by exactly one row, best score first, and
 * whatever is left over is genuinely new.
 */
export function assignMatches(
  candidates: Candidate[],
  existing: Existing[],
): { matched: Match[]; unmatchedCandidateIds: string[] } {
  const pairs: Match[] = [];
  for (const candidate of candidates) {
    for (const row of existing) {
      const match = scorePair(candidate, row);
      if (match) pairs.push(match);
    }
  }

  // Best first, then oldest-candidate-first so the result is deterministic
  // rather than dependent on input ordering.
  pairs.sort(
    (a, b) =>
      b.score - a.score ||
      a.candidateId.localeCompare(b.candidateId) ||
      a.existingId.localeCompare(b.existingId),
  );

  const claimedCandidates = new Set<string>();
  const claimedExisting = new Set<string>();
  const matched: Match[] = [];

  for (const pair of pairs) {
    if (claimedCandidates.has(pair.candidateId)) continue;
    if (claimedExisting.has(pair.existingId)) continue;
    claimedCandidates.add(pair.candidateId);
    claimedExisting.add(pair.existingId);
    matched.push(pair);
  }

  return {
    matched,
    unmatchedCandidateIds: candidates
      .map((c) => c.id)
      .filter((id) => !claimedCandidates.has(id)),
  };
}

/* --- shared text handling ------------------------------------------------ */

/** Words that appear in most bank descriptions and identify nothing. */
const NOISE = new Set([
  "upi", "neft", "imps", "rtgs", "ach", "atm", "pos", "vps", "mps",
  "txn", "ref", "payment", "paid", "purchase", "debit", "credit", "card",
  "transfer", "trf", "inb", "chq", "bil", "www", "com", "ltd", "pvt", "india",
]);

/**
 * The words in a description that actually identify a merchant.
 * Shared so a rule can never be keyed on something like "upi", which would
 * match every payment ever made.
 */
export function significantWords(text: string): string[] {
  return normalise(text)
    .split(" ")
    .filter((w) => w.length >= 3 && !NOISE.has(w) && !/^\d+$/.test(w));
}

/** Lowercase, strip punctuation and digit runs, collapse whitespace. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    // Long digit runs are reference numbers, not names.
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The merchant name a human would recognise, pulled out of a bank description.
 * "UPI/SWIGGY*BLR/8842217/Payment" becomes "swiggy blr".
 */
export function extractMerchant(description: string): string {
  return significantWords(description).slice(0, 3).join(" ");
}
