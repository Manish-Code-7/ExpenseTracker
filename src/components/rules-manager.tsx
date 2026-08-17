"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc, errorText } from "@/lib/trpc";
import type { CategoryTree } from "@/lib/types";

type Rule = {
  id: string;
  pattern: string;
  category_id: string;
  source: string;
  hit_count: number;
  category_name: string | null;
};

/**
 * What the app has worked out about your merchants, and a place to correct it.
 *
 * Rules the app inferred are marked as such and can be overridden; once you
 * change one it becomes yours and inference stops touching it.
 */
export function RulesManager({
  rules,
  categories,
}: {
  rules: Rule[];
  categories: CategoryTree[];
}) {
  const router = useRouter();
  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  const refresh = {
    onSuccess: () => router.refresh(),
    onError: (e: unknown) => setError(errorText(e)),
  };

  const upsert = trpc.rules.upsert.useMutation({
    onSuccess: () => {
      setPattern("");
      router.refresh();
    },
    onError: (e) => setError(errorText(e)),
  });
  const remove = trpc.rules.delete.useMutation(refresh);
  const backfill = trpc.rules.backfill.useMutation({
    onSuccess: (r) => {
      setError(r.created === 0 ? "Nothing new to learn from your history yet." : null);
      router.refresh();
    },
    onError: (e) => setError(errorText(e)),
  });

  return (
    <div className="space-y-5">
      <form
        className="card space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          upsert.mutate({ pattern, categoryId });
        }}
      >
        <div>
          <label className="label" htmlFor="pattern">When the merchant contains</label>
          <input
            id="pattern"
            className="field"
            required
            maxLength={60}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="swiggy"
          />
          <p className="mt-1.5 text-xs text-ink-muted">
            A fragment, not the full name — bank statements add reference numbers
            and city codes that change every time.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="rule-category">File it under</label>
          <select id="rule-category" className="field" value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

        <button type="submit" className="btn btn-secondary w-full" disabled={upsert.isPending}>
          {upsert.isPending ? "Saving…" : "Add rule"}
        </button>
      </form>

      {rules.length === 0 ? (
        <div className="card px-5 py-8 text-center">
          <p className="font-display text-base font-semibold text-ink">No rules yet</p>
          <p className="mx-auto mt-1.5 max-w-xs text-sm text-ink-soft">
            Rules appear on their own as you categorise things. You can also pull
            them from what you&rsquo;ve already recorded.
          </p>
          <button
            type="button"
            className="btn btn-secondary mt-4"
            disabled={backfill.isPending}
            onClick={() => backfill.mutate()}
          >
            {backfill.isPending ? "Reading history…" : "Learn from my history"}
          </button>
        </div>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-3 p-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">
                  <span className="font-medium">{r.pattern}</span>
                  <span className="text-ink-muted"> → </span>
                  {r.category_name ?? "Removed category"}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {r.source === "MANUAL" ? "Yours" : "Learned"}
                  {r.hit_count > 0 ? ` · used ${r.hit_count}×` : ""}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost h-8 min-h-8 shrink-0 px-2 text-xs text-danger"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ id: r.id })}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
