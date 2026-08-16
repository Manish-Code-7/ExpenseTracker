const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrPrecise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(value: number | string | null | undefined) {
  return inr.format(Number(value ?? 0));
}

export function moneyPrecise(value: number | string | null | undefined) {
  return inrPrecise.format(Number(value ?? 0));
}

/** Format a yyyy-mm-dd string without dragging it through a timezone. */
export function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateShort(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Text description of a payment method, e.g. "Credit Card · HDFC · Visa ····4321". */
export function methodSubtitle(m: {
  type: string;
  bank_name?: string | null;
  network?: string | null;
  last4?: string | null;
}) {
  return [
    m.type,
    m.bank_name || null,
    m.network || null,
    m.last4 ? `····${m.last4}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Readable relative day count: "today", "tomorrow", "in 4 days", "3 days ago". */
export function relativeDays(days: number) {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}
