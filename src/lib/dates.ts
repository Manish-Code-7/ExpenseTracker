/**
 * Date helpers. Everything here works on plain `yyyy-mm-dd` strings so that a
 * spend on the 1st of the month never slides into the previous month because
 * the server happens to run in UTC and the user is in IST.
 */

export function todayISO(): string {
  const now = new Date();
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function toISO(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseISO(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

export function startOfMonthISO(iso = todayISO()): string {
  const { y, m } = parseISO(iso);
  return toISO(y, m, 1);
}

export function addMonthsISO(iso: string, months: number): string {
  const { y, m, d } = parseISO(iso);
  const base = new Date(Date.UTC(y, m - 1 + months, 1));
  const daysInTarget = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return toISO(
    base.getUTCFullYear(),
    base.getUTCMonth() + 1,
    Math.min(d, daysInTarget),
  );
}

export function addDaysISO(iso: string, days: number): string {
  const { y, m, d } = parseISO(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function daysBetween(fromISO: string, toISOStr: string): number {
  const a = parseISO(fromISO);
  const b = parseISO(toISOStr);
  const ms =
    Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86_400_000);
}

export function monthLabel(iso = todayISO()): string {
  const { y, m } = parseISO(iso);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The current statement cycle for a credit card whose statement generates on
 * `billingCycleDay` each month: the window runs from the day *after* the last
 * statement up to today.
 *
 * e.g. cycle day 18, today 8 Aug → statement generated 18 Jul, so the current
 * cycle is 19 Jul … 8 Aug.
 */
export function currentCycle(
  billingCycleDay: number,
  today = todayISO(),
): { start: string; end: string; statementDate: string; nextStatement: string } {
  const { y, m, d } = parseISO(today);
  const lastStatement =
    d > billingCycleDay
      ? toISO(y, m, billingCycleDay)
      : addMonthsISO(toISO(y, m, billingCycleDay), -1);

  return {
    start: addDaysISO(lastStatement, 1),
    end: today,
    statementDate: lastStatement,
    nextStatement: addMonthsISO(lastStatement, 1),
  };
}
