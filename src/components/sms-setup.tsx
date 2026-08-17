"use client";

import { useState } from "react";
import { trpc, errorText } from "@/lib/trpc";

/**
 * Setting up the phone bridge.
 *
 * A website cannot read SMS — no browser exposes them, and Android restricts
 * the permission to default SMS apps. So a forwarder app on the phone relays
 * bank alerts here instead. This screen hands over the endpoint and a token
 * scoped to ingestion, nothing else.
 */
export function SmsSetup({
  initialToken,
  url,
}: {
  initialToken: string | null;
  url: string;
}) {
  const [token, setToken] = useState(initialToken);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rotate = trpc.import.rotateSmsToken.useMutation({
    onSuccess: (r) => {
      setToken(r.token);
      setError(null);
    },
    onError: (e) => setError(errorText(e)),
  });

  const copy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <section className="card space-y-4 p-4">
      <div>
        <p className="font-display text-base font-semibold text-ink">From SMS</p>
        <p className="mt-1 text-sm text-ink-soft">
          Most Indian banks text you the moment something is spent. A website
          can&rsquo;t read those, so a forwarder app on your phone relays them
          here — they land in the same review queue as everything else.
        </p>
      </div>

      {token ? (
        <>
          <div>
            <span className="label">Endpoint</span>
            <div className="flex gap-2">
              <input readOnly className="field tnum text-xs" value={url} />
              <button type="button" className="btn btn-secondary shrink-0 px-3"
                onClick={() => copy("url", url)}>
                {copied === "url" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          <div>
            <span className="label">Token</span>
            <div className="flex gap-2">
              <input readOnly type="password" className="field text-xs" value={token} />
              <button type="button" className="btn btn-secondary shrink-0 px-3"
                onClick={() => copy("token", token)}>
                {copied === "token" ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-ink-muted">
              Treat it like a password — anyone holding it can add pending items,
              though not read your data or move money.
            </p>
          </div>

          <details className="text-sm text-ink-soft">
            <summary className="cursor-pointer font-medium text-ink">
              How to set up the forwarder
            </summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs">
              <li>Install an SMS forwarding app (MacroDroid, Tasker or SMS Forwarder).</li>
              <li>Add a rule that triggers on a received SMS from your bank.</li>
              <li>
                Have it POST JSON to the endpoint above with the body:
                <pre className="mt-1 overflow-x-auto rounded-lg bg-[color-mix(in_oklab,var(--ink)_6%,transparent)] p-2">{`{
  "token": "<your token>",
  "from": "{sender}",
  "text": "{message}"
}`}</pre>
              </li>
              <li>Send yourself a test alert; it should appear below within seconds.</li>
            </ol>
          </details>

          <button type="button" className="btn btn-ghost text-xs"
            disabled={rotate.isPending} onClick={() => rotate.mutate()}>
            {rotate.isPending ? "Rotating…" : "Rotate token"}
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-secondary w-full"
          disabled={rotate.isPending} onClick={() => rotate.mutate()}>
          {rotate.isPending ? "Generating…" : "Set up SMS forwarding"}
        </button>
      )}

      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    </section>
  );
}
