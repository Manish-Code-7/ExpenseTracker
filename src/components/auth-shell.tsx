/**
 * A stack of card edges seen through the glass — the same shape the wallet
 * uses, stating the premise before you sign in: this tracker is organised by
 * what you paid with.
 */
const CARD_EDGES = ["#22c55e", "#6366f1", "#f59e0b", "#ec4899"];

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-7">
        <div aria-hidden className="mb-6 flex h-16 items-end gap-1.5">
          {CARD_EDGES.map((color, i) => (
            <span
              key={color}
              className="w-9 rounded-t-lg"
              style={{
                background: color,
                height: `${100 - i * 16}%`,
                boxShadow: `0 6px 20px ${color}59`,
              }}
            />
          ))}
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
          {title}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">{subtitle}</p>
      </div>

      <div className="card p-5">{children}</div>
    </main>
  );
}
