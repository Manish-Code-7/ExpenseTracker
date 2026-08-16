"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc, errorText } from "@/lib/trpc";
import { transactionInput } from "@/lib/schemas";
import { todayISO } from "@/lib/dates";
import {
  PAYMENT_METHODS,
  RULES,
  TRANSACTION_TYPES,
  typeLabel,
  type AccountType,
  type TransactionType,
} from "@/lib/financial";
import type { CategoryTree } from "@/lib/types";

type AccountOption = { id: string; name: string; type: AccountType };

/**
 * One form, seven shapes. The transaction type is picked first and the rest of
 * the fields follow from RULES, so an irrelevant field is never shown — a
 * transfer has no category, an expense has no destination.
 */
export type ExistingTransaction = {
  id: string;
  type: TransactionType;
  amount: number;
  source_account_id: string | null;
  destination_account_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  payment_method: string | null;
  date: string;
  merchant: string | null;
  description: string | null;
  notes: string | null;
};

export function TransactionForm({
  accounts,
  categories,
  initialType = "EXPENSE",
  transaction,
}: {
  accounts: AccountOption[];
  categories: CategoryTree[];
  initialType?: TransactionType;
  /** Present when editing; absent when creating. */
  transaction?: ExistingTransaction;
}) {
  const router = useRouter();
  const [type, setType] = useState<TransactionType>(transaction?.type ?? initialType);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : "");
  const [source, setSource] = useState(transaction?.source_account_id ?? "");
  const [destination, setDestination] = useState(transaction?.destination_account_id ?? "");
  const [categoryId, setCategoryId] = useState(transaction?.category_id ?? "");
  const [subcategoryId, setSubcategoryId] = useState(transaction?.subcategory_id ?? "");
  const [method, setMethod] = useState<string>(transaction?.payment_method ?? "UPI");
  const [date, setDate] = useState(transaction?.date ?? todayISO());
  const [merchant, setMerchant] = useState(transaction?.merchant ?? "");
  const [description, setDescription] = useState(transaction?.description ?? "");
  const [notes, setNotes] = useState(transaction?.notes ?? "");

  const rule = RULES[type];
  const spendingType = type === "EXPENSE";
  const cashOnly = type === "CASH_WITHDRAWAL";
  const cardPayment = type === "CREDIT_CARD_PAYMENT";

  // Only offer accounts that make sense for each side of this type.
  const sourceOptions = accounts.filter((a) =>
    cashOnly || cardPayment ? a.type !== "CREDIT_CARD" && a.type !== "OTHER_LIABILITY" : true,
  );
  const destinationOptions = accounts.filter((a) => {
    if (cashOnly) return a.type === "CASH";
    if (cardPayment) return a.type === "CREDIT_CARD";
    if (type === "TRANSFER") return a.type !== "CREDIT_CARD" && a.type !== "OTHER_LIABILITY";
    return true;
  });

  const subcategories = categories.find((c) => c.id === categoryId)?.children ?? [];

  const done = () => {
    router.push("/transactions");
    router.refresh();
  };
  const create = trpc.transactions.create.useMutation({
    onSuccess: done,
    onError: (e) => setError(errorText(e)),
  });
  const update = trpc.transactions.update.useMutation({
    onSuccess: done,
    onError: (e) => setError(errorText(e)),
  });
  const checkDuplicate = trpc.transactions.checkDuplicate.useMutation();
  const pending = create.isPending || update.isPending;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = transactionInput.safeParse({
      type,
      amount: Number(amount),
      source_account_id: rule.source === "required" ? source || null : null,
      destination_account_id: rule.destination === "required" ? destination || null : null,
      category_id: spendingType ? categoryId || null : null,
      subcategory_id: spendingType ? subcategoryId || null : null,
      payment_method: spendingType || type === "TRANSFER" ? method : null,
      date,
      merchant: merchant.trim() || null,
      description: description.trim() || null,
      notes: notes.trim() || null,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    if (transaction) {
      update.mutate({ id: transaction.id, values: parsed.data });
      return;
    }

    // Warn once about a near-identical recent entry, then let them through.
    if (!warning) {
      const check = await checkDuplicate.mutateAsync(parsed.data);
      if (check.duplicate) {
        setWarning("You recorded something almost identical moments ago. Submit again to keep it.");
        return;
      }
    }

    create.mutate(parsed.data);
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <section className="card p-4">
        <span className="label">Type</span>
        <div className="flex flex-wrap gap-2">
          {TRANSACTION_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setType(t);
                setWarning(null);
              }}
              aria-pressed={type === t}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                type === t ? "bg-ink text-paper" : "border border-line-strong text-ink-soft hover:text-ink"
              }`}
            >
              {typeLabel(t)}
            </button>
          ))}
        </div>
      </section>

      <section className="card p-4">
        <label className="label" htmlFor="amount">
          Amount
        </label>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl text-ink-muted">₹</span>
          <input
            id="amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            required
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="tnum w-full min-w-0 border-0 bg-transparent p-0 font-display text-4xl font-semibold text-ink outline-none placeholder:text-ink-muted"
          />
        </div>
      </section>

      <section className="card space-y-4 p-4">
        {rule.source === "required" ? (
          <div>
            <label className="label" htmlFor="source">
              {cardPayment ? "Pay from" : cashOnly ? "Withdraw from" : "From account"}
            </label>
            <select id="source" className="field" required value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">Choose…</option>
              {sourceOptions.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        ) : null}

        {rule.destination === "required" ? (
          <div>
            <label className="label" htmlFor="destination">
              {cardPayment ? "Credit card" : cashOnly ? "Into cash" : "To account"}
            </label>
            <select id="destination" className="field" required value={destination} onChange={(e) => setDestination(e.target.value)}>
              <option value="">Choose…</option>
              {destinationOptions.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        ) : null}

        {spendingType ? (
          <>
            <div>
              <label className="label" htmlFor="category">Category</label>
              <select
                id="category"
                className="field"
                required
                value={categoryId}
                onChange={(e) => { setCategoryId(e.target.value); setSubcategoryId(""); }}
              >
                <option value="">Choose…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {subcategories.length > 0 ? (
              <div>
                <label className="label" htmlFor="subcategory">
                  Subcategory <span className="normal-case">(optional)</span>
                </label>
                <select id="subcategory" className="field" value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)}>
                  <option value="">None</option>
                  {subcategories.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            ) : null}

            <div>
              <label className="label" htmlFor="merchant">
                Merchant <span className="normal-case">(optional)</span>
              </label>
              <input id="merchant" className="field" maxLength={80} value={merchant}
                onChange={(e) => setMerchant(e.target.value)} placeholder="Swiggy, Amazon…" />
            </div>
          </>
        ) : null}

        {spendingType || type === "TRANSFER" ? (
          <div>
            <label className="label" htmlFor="method">Payment method</label>
            <select id="method" className="field" value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{m.replace("_", " ")}</option>
              ))}
            </select>
          </div>
        ) : null}

        <div>
          <label className="label" htmlFor="date">Date</label>
          <input id="date" type="date" required className="field tnum" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <div>
          <label className="label" htmlFor="description">
            Description <span className="normal-case">(optional)</span>
          </label>
          <input id="description" className="field" maxLength={140} value={description}
            onChange={(e) => setDescription(e.target.value)} placeholder="Lunch, rent, salary…" />
        </div>

        <div>
          <label className="label" htmlFor="notes">
            Notes <span className="normal-case">(optional)</span>
          </label>
          <input id="notes" className="field" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </section>

      {warning ? <p role="status" className="text-sm text-danger">{warning}</p> : null}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

      <div className="flex gap-3">
        <button type="submit" className="btn btn-primary flex-1" disabled={pending}>
          {pending ? "Saving…" : transaction ? "Save changes" : warning ? "Add anyway" : `Add ${typeLabel(type).toLowerCase()}`}
        </button>
        <Link href="/transactions" className="btn btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}
