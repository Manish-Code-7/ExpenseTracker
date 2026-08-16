"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc, errorText } from "@/lib/trpc";
import { PROVIDER_LABELS, toBubbles, type ChatMessage } from "@/lib/chat";
import { CHAT_PROVIDERS, type ChatProvider } from "@/lib/schemas";

const OPENERS = [
  "Paid 450 for lunch using GPay from HDFC",
  "Transfer 10000 from HDFC to SBI",
  "Withdraw 5000 from HDFC",
  "How much did I spend this month?",
];

export function ChatPanel({
  canLog,
  available,
  initialProvider,
}: {
  canLog: boolean;
  available: Record<ChatProvider, boolean>;
  initialProvider: ChatProvider;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [provider, setProvider] = useState<ChatProvider>(initialProvider);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const bubbles = toBubbles(messages);

  const send = trpc.chat.send.useMutation({
    onSuccess: (data) => {
      setSessionId(data.sessionId);
      setMessages(data.messages);
      void utils.chat.sessions.invalidate();
      // Something was written — let the other screens pick it up.
      if (data.logged) router.refresh();
    },
    onError: (err, variables) => {
      setError(errorText(err));
      setDraft(variables.message);
    },
    onSettled: () => setPending(null),
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [bubbles.length, pending]);

  function submit(text: string) {
    const message = text.trim();
    if (!message || send.isPending) return;
    setDraft("");
    setError(null);
    setPending(message);
    send.mutate({ sessionId, message, provider });
  }

  function startOver() {
    setSessionId(null);
    setMessages([]);
    setError(null);
    setDraft("");
  }

  const enabled = CHAT_PROVIDERS.filter((p) => available[p]);

  return (
    <div className="flex min-h-[60vh] flex-col gap-4">
      {enabled.length > 1 ? (
        <div className="flex items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Model"
            className="card flex gap-1 p-1"
          >
            {enabled.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={provider === p}
                onClick={() => setProvider(p)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  provider === p
                    ? "bg-ink text-paper"
                    : "text-ink-soft hover:text-ink"
                }`}
              >
                {PROVIDER_LABELS[p]}
              </button>
            ))}
          </div>
          {messages.length > 0 ? (
            <button
              type="button"
              onClick={startOver}
              className="btn btn-ghost ml-auto h-9 min-h-9 px-2.5 text-xs"
            >
              New chat
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex-1 space-y-3">
        {bubbles.length === 0 && !pending ? (
          <div className="card p-5">
            <p className="font-display text-lg font-semibold text-ink">
              Tell me what you spent
            </p>
            <p className="mt-1.5 text-sm text-ink-soft">
              Plain sentences are fine — I&rsquo;ll pick the category and the
              payment method, and log it for you.
            </p>
            {canLog ? (
              <ul className="mt-4 space-y-2">
                {OPENERS.map((o) => (
                  <li key={o}>
                    <button
                      type="button"
                      onClick={() => submit(o)}
                      className="w-full rounded-xl border border-line-strong px-3 py-2 text-left text-sm text-ink-soft transition-colors hover:text-ink"
                    >
                      &ldquo;{o}&rdquo;
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-ink-muted">
                Add at least one{" "}
                <Link href="/methods/new" className="underline">
                  payment method
                </Link>{" "}
                first — I need somewhere to put the spend.
              </p>
            )}
          </div>
        ) : null}

        {bubbles.map((b) =>
          b.kind === "receipt" ? (
            <div
              key={b.key}
              className="card flex items-start gap-3 border-l-2 border-l-ink p-3.5"
            >
              <CheckIcon />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {b.typeLabel}
                </p>
                <p className="tnum mt-0.5 text-sm text-ink">{b.summary}</p>
                {b.warning ? (
                  <p className="mt-1 text-xs text-danger">{b.warning}</p>
                ) : null}
              </div>
              <Link
                href={`/transactions/${b.transactionId}/edit`}
                className="btn btn-ghost h-8 min-h-8 shrink-0 px-2 text-xs"
              >
                Edit
              </Link>
            </div>
          ) : (
            <div
              key={b.key}
              className={
                b.role === "user" ? "flex justify-end" : "flex flex-col items-start"
              }
            >
              {b.role === "assistant" && b.provider && enabled.length > 1 ? (
                <span className="mb-1 text-[11px] font-medium text-ink-muted">
                  {PROVIDER_LABELS[b.provider]}
                </span>
              ) : null}
              <p
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${
                  b.role === "user" ? "bg-ink text-paper" : "card text-ink"
                }`}
              >
                {b.text}
              </p>
            </div>
          ),
        )}

        {pending ? (
          <>
            <div className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-ink px-3.5 py-2.5 text-sm text-paper opacity-60">
                {pending}
              </p>
            </div>
            <p className="text-sm text-ink-muted" role="status">
              Working on it…
            </p>
          </>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div ref={endRef} />
      </div>

      <form
        className="sticky bottom-20 flex items-end gap-2 md:bottom-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Message the assistant
        </label>
        <textarea
          id="chat-input"
          className="field max-h-40 min-h-[44px] flex-1 resize-none"
          rows={1}
          value={draft}
          placeholder="450 on Swiggy with the HDFC card"
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(draft);
            }
          }}
        />
        <button
          type="submit"
          className="btn btn-primary shrink-0"
          disabled={!draft.trim() || send.isPending}
        >
          Send
        </button>
      </form>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="mt-0.5 shrink-0 text-ink"
    >
      <path d="m4 12.5 5.5 5.5L20 6.5" />
    </svg>
  );
}
