"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc, errorText } from "@/lib/trpc";
import { moneyPrecise, formatDate } from "@/lib/format";
import { typeLabel } from "@/lib/financial";
import type { CategoryTree } from "@/lib/types";

type AccountOption = { id: string; name: string };
type Staged = {
  id: string;
  date: string;
  amount: number;
  merchant: string | null;
  type: string;
  suggestedCategoryId: string | null;
  status: string;
  matchReason: string | null;
};

/**
 * Upload, review, confirm.
 *
 * Rows that look like something already in the ledger start unticked, with the
 * reason shown — the judgement is visible and overridable rather than hidden.
 */
export function ImportReview({
  accounts,
  categories,
  initialPending,
}: {
  accounts: AccountOption[];
  categories: CategoryTree[];
  initialPending: Staged[];
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [items, setItems] = useState<Staged[]>(initialPending);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialPending.filter((i) => i.status === "PENDING").map((i) => i.id)),
  );
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const stage = trpc.import.stageStatement.useMutation({
    onSuccess: (r) => {
      setItems((prev) => [...prev, ...r.staged]);
      setSelected((prev) => {
        const next = new Set(prev);
        r.staged.filter((i) => i.status === "PENDING").forEach((i) => next.add(i.id));
        return next;
      });
      const parts = [`${r.fresh} new`];
      if (r.likelyTracked) parts.push(`${r.likelyTracked} look already tracked`);
      if (r.alreadyImported) parts.push(`${r.alreadyImported} imported before`);
      if (r.skipped.length) parts.push(`${r.skipped.length} unreadable`);
      setSummary(parts.join(" · "));
    },
    onError: (e) => setError(errorText(e)),
  });

  const confirm = trpc.import.confirm.useMutation({
    onSuccess: (r) => {
      setItems((prev) => prev.filter((i) => !selected.has(i.id)));
      setSelected(new Set());
      setSummary(`Imported ${r.imported}.`);
      router.refresh();
    },
    onError: (e) => setError(errorText(e)),
  });

  const ignore = trpc.import.ignore.useMutation({
    onSuccess: () => {
      setItems((prev) => prev.filter((i) => !selected.has(i.id)));
      setSelected(new Set());
      setSummary("Dismissed.");
      router.refresh();
    },
    onError: (e) => setError(errorText(e)),
  });

  async function onFile(file: File) {
    setError(null);
    setSummary(null);
    setReading(true);
    try {
      const csv = await file.text();
      await stage.mutateAsync({ accountId, csv });
    } catch {
      /* surfaced by onError */
    } finally {
      setReading(false);
    }
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const busy = stage.isPending || confirm.isPending || ignore.isPending || reading;

  return (
    <div className="space-y-5">
      <section className="card space-y-4 p-4">
        <div>
          <label className="label" htmlFor="account">Statement is for</label>
          <select id="account" className="field" value={accountId}
            onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="file">CSV export</label>
          <input
            id="file"
            type="file"
            accept=".csv,text/csv,text/plain"
            className="field"
            disabled={!accountId || busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
          <p className="mt-1.5 text-xs text-ink-muted">
            Download it from your bank as CSV. Nothing is added until you confirm below,
            and re-uploading the same statement won&rsquo;t duplicate anything.
          </p>
        </div>

        {summary ? <p role="status" className="text-sm text-ink-soft">{summary}</p> : null}
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      </section>

      {items.length === 0 ? (
        <div className="card px-5 py-10 text-center">
          <p className="font-display text-lg font-semibold text-ink">Nothing waiting</p>
          <p className="mx-auto mt-1.5 max-w-xs text-sm text-ink-soft">
            Upload a statement above, and anything not already in your ledger will appear here.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <p className="text-sm text-ink-soft">
              {selected.size} of {items.length} selected
            </p>
            <button type="button" className="btn btn-ghost ml-auto h-8 min-h-8 px-2 text-xs"
              onClick={() => setSelected(new Set(items.map((i) => i.id)))}>
              Select all
            </button>
            <button type="button" className="btn btn-ghost h-8 min-h-8 px-2 text-xs"
              onClick={() => setSelected(new Set())}>
              None
            </button>
          </div>

          <ul className="card divide-y divide-line overflow-hidden">
            {items.map((item) => {
              const dup = item.status === "DUPLICATE";
              return (
                <li key={item.id} className={`flex items-start gap-3 p-4 ${dup ? "opacity-70" : ""}`}>
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                    aria-label={`Select ${item.merchant ?? "transaction"}`}
                  />

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">
                      {item.merchant || "(no description)"}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      <span className="tnum">{formatDate(item.date)}</span>
                      <span aria-hidden> · </span>
                      {typeLabel(item.type as never)}
                    </p>
                    {dup ? (
                      <p className="mt-1 text-xs text-ink-soft">
                        Looks already tracked — {item.matchReason}
                      </p>
                    ) : null}

                    {item.type === "EXPENSE" ? (
                      <select
                        className="field mt-2 h-9 py-1 text-sm"
                        value={overrides[item.id] ?? item.suggestedCategoryId ?? ""}
                        onChange={(e) =>
                          setOverrides((p) => ({ ...p, [item.id]: e.target.value }))
                        }
                      >
                        <option value="">No category</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    ) : null}
                  </div>

                  <span className="tnum shrink-0 font-display text-base font-semibold text-ink">
                    {moneyPrecise(item.amount)}
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="flex gap-3">
            <button
              type="button"
              className="btn btn-primary flex-1"
              disabled={selected.size === 0 || busy}
              onClick={() =>
                confirm.mutate({
                  items: [...selected].map((id) => ({
                    id,
                    categoryId:
                      overrides[id] ?? items.find((i) => i.id === id)?.suggestedCategoryId ?? null,
                  })),
                })
              }
            >
              {confirm.isPending ? "Importing…" : `Import ${selected.size}`}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={selected.size === 0 || busy}
              onClick={() => ignore.mutate({ ids: [...selected] })}
            >
              Dismiss
            </button>
          </div>
          <p className="text-xs text-ink-muted">
            Dismissing a row that matched an existing transaction records the bank&rsquo;s
            reference against it, so future statements match it exactly.
          </p>
        </>
      )}

      <Link href="/transactions" className="btn btn-ghost">Back to activity</Link>
    </div>
  );
}
