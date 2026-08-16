export const metadata = { title: "Offline — Ledger" };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 text-center">
      <h1 className="font-display text-2xl font-semibold text-ink">
        You&rsquo;re offline
      </h1>
      <p className="mt-2 text-sm text-ink-soft">
        Ledger needs a connection to load your spend. Reconnect and try again —
        nothing you&rsquo;ve already saved is lost.
      </p>
      <p className="mt-6">
        <a href="/dashboard" className="btn btn-primary">
          Try again
        </a>
      </p>
    </main>
  );
}
