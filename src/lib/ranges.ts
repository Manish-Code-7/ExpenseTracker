import { addDaysISO, addMonthsISO, startOfMonthISO, todayISO, parseISO, toISO } from "@/lib/dates";

/**
 * Natural-language date ranges (§35).
 *
 * Shared by the dashboard and the chatbot so "this month" means the same span
 * in a chart as it does in an answer. Everything works on yyyy-mm-dd strings,
 * matching the rest of the app, so a spend on the 1st never slides into the
 * previous month because the server runs in UTC and the user is in IST.
 */
export type DateRange = { from: string; to: string };

export function monthRange(iso = todayISO()): DateRange {
  return { from: startOfMonthISO(iso), to: endOfMonthISO(iso) };
}

export function endOfMonthISO(iso = todayISO()): string {
  const { y, m } = parseISO(iso);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return toISO(y, m, lastDay);
}

/** Monday-start week, which is how Indian users read "this week". */
export function weekRange(iso = todayISO()): DateRange {
  const { y, m, d } = parseISO(iso);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const back = weekday === 0 ? 6 : weekday - 1;
  return { from: addDaysISO(iso, -back), to: iso };
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * Resolves the phrases the chatbot is allowed to pass. Unrecognised input
 * falls back to the current month rather than guessing — a wrong range gives
 * a confidently wrong number, which is worse than a conservative default.
 */
export function rangeFor(phrase: string, today = todayISO()): DateRange {
  const p = phrase.trim().toLowerCase();
  const { y } = parseISO(today);

  if (p === "today") return { from: today, to: today };
  if (p === "yesterday") {
    const d = addDaysISO(today, -1);
    return { from: d, to: d };
  }
  if (p === "this week") return weekRange(today);
  if (p === "last week") {
    const start = addDaysISO(weekRange(today).from, -7);
    return { from: start, to: addDaysISO(start, 6) };
  }
  if (p === "this month" || p === "") return monthRange(today);
  if (p === "last month") return monthRange(addMonthsISO(startOfMonthISO(today), -1));
  if (p === "this year") return { from: toISO(y, 1, 1), to: toISO(y, 12, 31) };
  if (p === "last year") return { from: toISO(y - 1, 1, 1), to: toISO(y - 1, 12, 31) };
  if (p === "all time") return { from: "1900-01-01", to: today };

  // "in august" / "august" — this year, or last year if it hasn't happened yet.
  const named = MONTHS.findIndex((name) => p === name || p === `in ${name}`);
  if (named >= 0) {
    const month = named + 1;
    const { m: currentMonth } = parseISO(today);
    const year = month > currentMonth ? y - 1 : y;
    return monthRange(toISO(year, month, 1));
  }

  // "between 2026-08-01 and 2026-08-10"
  const explicit = p.match(/(\d{4}-\d{2}-\d{2}).*?(\d{4}-\d{2}-\d{2})/);
  if (explicit) return { from: explicit[1], to: explicit[2] };

  return monthRange(today);
}

/* --- amount parsing (§36) ------------------------------------------------- */

/**
 * Indian shorthand: 5k, 1.5k, 2L, 2 lakh, ₹500, "500 rs".
 * Returns null when there is no amount to find, so callers can ask rather
 * than invent a number.
 */
export function parseAmount(text: string): number | null {
  // Commas are removed, not spaced out: "1,200" must stay one number, or the
  // regex below stops at the 1 and reads it as ₹1.
  const cleaned = text.replace(/,/g, "").replace(/₹/g, " ").toLowerCase();
  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*(k|l|lakh|lac|cr|crore)?/);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;

  switch (match[2]) {
    case "k":
      return value * 1_000;
    case "l":
    case "lakh":
    case "lac":
      return value * 100_000;
    case "cr":
    case "crore":
      return value * 10_000_000;
    default:
      return value;
  }
}
