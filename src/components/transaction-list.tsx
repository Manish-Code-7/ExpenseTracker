"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { ColorDot } from "@/components/method-chip";
import { moneyPrecise, formatDate } from "@/lib/format";
import {
  PAYMENT_METHODS,
  TRANSACTION_TYPES,
  typeLabel,
  type TransactionType,
} from "@/lib/financial";
import type { CategoryTree } from "@/lib/types";

type AccountOption = { id: string; name: string };

/**
 * The activity list: every transaction type in one place, filterable.
 *
 * Each row states what kind of movement it was — "HDFC → SBI · Transfer" reads
 * differently from "₹800 Food · Cash Expense", and that distinction is the
 * whole point of the ledger.
 */
export function TransactionList({
  accounts,
  categories,
}: {
  accounts: AccountOption[];
  categories: CategoryTree[];
}) {
  const [page, setPage] = useState(1);
  const [type, setType] = useState<TransactionType | "">("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const query = trpc.transactions.list.useQuery({
    page,
    type: type || null,
    accountId: accountId || null,
    categoryId: categoryId || null,
    paymentMethod: (paymentMethod || null) as never,
    search: search.trim() || null,
    from: from || null,
    to: to || null,
  });

  const data = query.data;
  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hasFilters = Boolean(type || accountId || categoryId || paymentMethod || search || from || to);

  return (
    <>
      <div className="card mb-4 grid grid-cols-2 gap-3 p-4">
        <div className="col-span-2">
          <label className="label" htmlFor="search">Search</label>
          <input
            id="search"
            className="field"
            value={search}
            onChange={(e) => reset(setSearch)(e.target.value)}
            placeholder="Zomato, rent, laptop…"
          />
        </div>

        <div>
          <label className="label" htmlFor="type">Type</label>
          <select id="type" className="field" value={type}
            onChange={(e) => reset(setType)(e.target.value as TransactionType | "")}>
            <option value="">All types</option>
            {TRANSACTION_TYPES.map((t) => (
              <option key={t} value={t}>{typeLabel(t)}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="account">Account</label>
          <select id="account" className="field" value={accountId}
            onChange={(e) => reset(setAccountId)(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="category">Category</label>
          <select id="category" className="field" value={categoryId}
            onChange={(e) => reset(setCategoryId)(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="method">Paid by</label>
          <select id="method" className="field" value={paymentMethod}
            onChange={(e) => reset(setPaymentMethod)(e.target.value)}>
            <option value="">Any method</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{m.replace("_", " ")}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="from">From</label>
          <input id="from" type="date" className="field tnum" value={from}
            onChange={(e) => reset(setFrom)(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="to">To</label>
          <input id="to" type="date" className="field tnum" value={to}
            onChange={(e) => reset(setTo)(e.target.value)} />
        </div>

        {hasFilters ? (
          <button
            type="button"
            className="btn btn-ghost col-span-2"
            onClick={() => {
              setType(""); setAccountId(""); setCategoryId("");
              setPaymentMethod(""); setSearch(""); setFrom(""); setTo(""); setPage(1);
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {query.isPending ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : !data || data.items.length === 0 ? (
        <div className="card px-5 py-10 text-center">
          <p className="font-display text-lg font-semibold text-ink">
            {hasFilters ? "Nothing matches" : "Nothing recorded yet"}
          </p>
          <p className="mx-auto mt-1.5 max-w-xs text-sm text-ink-soft">
            {hasFilters
              ? "Widen the dates, or clear the filters to see everything."
              : "Add a transaction, or just tell the assistant what you spent."}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Link href="/transactions/new" className="btn btn-primary">Add transaction</Link>
            {!hasFilters ? <Link href="/chat" className="btn btn-secondary">Ask the assistant</Link> : null}
          </div>
        </div>
      ) : (
        <>
          <p className="mb-2 text-sm text-ink-soft">
            {data.total} {data.total === 1 ? "transaction" : "transactions"}
          </p>
          <ul className="card divide-y divide-line overflow-hidden">
            {data.items.map((t) => {
              const isSpend = t.type === "EXPENSE";
              const isIn = t.type === "INCOME" || t.type === "REFUND";
              const colour = t.source?.color_tag ?? t.destination?.color_tag ?? "#94a3b8";
              // "HDFC → SBI" for movements, just the account for one-sided rows.
              const where = t.source && t.destination
                ? `${t.source.name} → ${t.destination.name}`
                : (t.source?.name ?? t.destination?.name ?? "Removed account");

              return (
                <li key={t.id} className="flex items-start gap-3 p-4">
                  <span aria-hidden className="mt-1 h-8 w-1 shrink-0 rounded-full"
                    style={{ background: colour }} />

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">
                      {t.merchant || t.description || t.category?.name || typeLabel(t.type)}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      {where}
                      <span aria-hidden> · </span>
                      {typeLabel(t.type)}
                      {t.category ? <> <span aria-hidden>·</span> {t.category.name}</> : null}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
                      <ColorDot color={colour} size={8} />
                      <span className="tnum">{formatDate(t.date)}</span>
                      {t.payment_method ? (
                        <><span aria-hidden>·</span><span>{t.payment_method.replace("_", " ")}</span></>
                      ) : null}
                      {t.refunded > 0 ? (
                        <><span aria-hidden>·</span>
                        <span>{moneyPrecise(t.refunded)} refunded</span></>
                      ) : null}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`tnum font-display text-base font-semibold ${
                      isIn ? "text-positive" : isSpend ? "text-ink" : "text-ink-soft"
                    }`}>
                      {isIn ? "+" : isSpend ? "−" : ""}{moneyPrecise(Math.abs(t.amount))}
                    </span>
                    <Link href={`/transactions/${t.id}/edit`}
                      className="btn btn-ghost h-8 min-h-8 px-2 text-xs">
                      Edit
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>

          {lastPage > 1 ? (
            <nav aria-label="Pagination" className="mt-4 flex items-center justify-between">
              {page > 1 ? (
                <button type="button" className="btn btn-secondary" onClick={() => setPage(page - 1)}>Previous</button>
              ) : <span />}
              <span className="tnum text-sm text-ink-muted">Page {page} of {lastPage}</span>
              {page < lastPage ? (
                <button type="button" className="btn btn-secondary" onClick={() => setPage(page + 1)}>Next</button>
              ) : <span />}
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
