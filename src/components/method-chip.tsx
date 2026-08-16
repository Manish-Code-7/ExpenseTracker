import { methodSubtitle } from "@/lib/format";

type MethodLike = {
  nickname: string;
  color_tag: string;
  type: string;
  bank_name?: string | null;
  network?: string | null;
  last4?: string | null;
};

/** A single color dot — the smallest unit of "which method paid for this". */
export function ColorDot({
  color,
  size = 10,
}: {
  color: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: color }}
    />
  );
}

/**
 * The signature element: a card edge peeking out of a wallet. The colored bar
 * on the left is the same color_tag used in the wallet, the expense list and
 * every chart, so a color learned once is readable everywhere.
 */
export function MethodChip({
  method,
  size = "sm",
}: {
  method: MethodLike;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-md border border-line-strong bg-card backdrop-blur-md ${
        size === "sm" ? "py-0.5 pr-2 text-xs" : "py-1 pr-2.5 text-sm"
      } overflow-hidden`}
    >
      <span
        aria-hidden
        className="self-stretch"
        style={{ width: 4, background: method.color_tag }}
      />
      <span className="truncate font-medium text-ink">{method.nickname}</span>
    </span>
  );
}

/** Two-line identity used in the wallet list and on detail screens. */
export function MethodIdentity({ method }: { method: MethodLike }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden
        className="h-9 w-1.5 shrink-0 rounded-full"
        style={{ background: method.color_tag }}
      />
      <div className="min-w-0">
        <p className="truncate font-medium text-ink">{method.nickname}</p>
        <p className="truncate text-xs text-ink-muted">
          {methodSubtitle(method)}
        </p>
      </div>
    </div>
  );
}
