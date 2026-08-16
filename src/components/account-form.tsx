"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc, errorText } from "@/lib/trpc";
import { accountInput } from "@/lib/schemas";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/financial";

const SWATCHES = ["#22c55e","#0ea5e9","#6366f1","#a855f7","#ec4899","#ef4444","#f59e0b","#84cc16","#14b8a6","#64748b"];

const TYPE_LABEL: Record<AccountType, string> = {
  BANK: "Bank account",
  CREDIT_CARD: "Credit card",
  CASH: "Cash",
  OTHER_ASSET: "Other asset",
  OTHER_LIABILITY: "Other liability",
};

const TYPE_HINT: Record<AccountType, string> = {
  BANK: "Savings, current, salary — anything money sits in.",
  CREDIT_CARD: "A liability. Purchases add to what you owe; paying the bill reduces it.",
  CASH: "Notes in your wallet. Withdrawals move money here, spending takes it out.",
  OTHER_ASSET: "Anything else you own that holds value.",
  OTHER_LIABILITY: "Anything else you owe.",
};

type Existing = {
  id: string;
  name: string;
  type: AccountType;
  institution_name: string | null;
  account_number_last4: string | null;
  credit_limit: number | null;
  billing_cycle_day: number | null;
  color_tag: string;
  opening_balance: number;
  current_balance: number;
};

export function AccountForm({ account }: { account?: Existing }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "BANK");
  const [institution, setInstitution] = useState(account?.institution_name ?? "");
  const [last4, setLast4] = useState(account?.account_number_last4 ?? "");
  const [opening, setOpening] = useState(account ? String(account.opening_balance) : "0");
  const [limit, setLimit] = useState(account?.credit_limit != null ? String(account.credit_limit) : "");
  const [cycleDay, setCycleDay] = useState(account?.billing_cycle_day != null ? String(account.billing_cycle_day) : "");
  const [color, setColor] = useState(account?.color_tag ?? SWATCHES[2]);

  const isCard = type === "CREDIT_CARD";
  const done = () => { router.push("/accounts"); router.refresh(); };
  const fail = (e: unknown) => setError(errorText(e));

  const create = trpc.accounts.create.useMutation({ onSuccess: done, onError: fail });
  const update = trpc.accounts.update.useMutation({ onSuccess: done, onError: fail });
  const pending = create.isPending || update.isPending;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = accountInput.safeParse({
      name,
      type,
      institution_name: institution,
      account_number_last4: last4,
      // A card's opening balance is what you owe, held as a negative number.
      opening_balance: isCard ? -Math.abs(Number(opening || 0)) : Number(opening || 0),
      credit_limit: limit.trim() === "" ? null : Number(limit),
      billing_cycle_day: cycleDay.trim() === "" ? null : Number(cycleDay),
      color_tag: color,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    if (account) update.mutate({ id: account.id, values: parsed.data });
    else create.mutate(parsed.data);
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <section className="card space-y-4 p-4">
        <div>
          <label className="label" htmlFor="type">Type</label>
          <select id="type" className="field" value={type}
            onChange={(e) => setType(e.target.value as AccountType)}>
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
          <p className="mt-1.5 text-xs text-ink-muted">{TYPE_HINT[type]}</p>
        </div>

        <div>
          <label className="label" htmlFor="name">Name</label>
          <input id="name" className="field" required maxLength={60} value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isCard ? "HDFC Millennia" : type === "CASH" ? "Cash" : "HDFC Savings"} />
          <p className="mt-1.5 text-xs text-ink-muted">
            What you&rsquo;d call it out loud. The assistant matches on this name.
          </p>
        </div>

        {type !== "CASH" ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="institution">
                Bank <span className="normal-case">(optional)</span>
              </label>
              <input id="institution" className="field" maxLength={60} value={institution}
                onChange={(e) => setInstitution(e.target.value)} placeholder="HDFC" />
            </div>
            <div>
              <label className="label" htmlFor="last4">
                Last 4 <span className="normal-case">(optional)</span>
              </label>
              <input id="last4" className="field" inputMode="numeric" maxLength={4} value={last4}
                onChange={(e) => setLast4(e.target.value)} placeholder="4321" />
            </div>
          </div>
        ) : null}
      </section>

      <section className="card space-y-4 p-4">
        {!account ? (
          <div>
            <label className="label" htmlFor="opening">
              {isCard ? "Currently owed" : "Current balance"}
            </label>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl text-ink-muted">₹</span>
              <input id="opening" type="number" step="0.01" className="tnum w-full min-w-0 border-0 bg-transparent p-0 font-display text-3xl font-semibold text-ink outline-none"
                value={opening} onChange={(e) => setOpening(e.target.value)} />
            </div>
            <p className="mt-1.5 text-xs text-ink-muted">
              {isCard
                ? "What's outstanding on the card right now. Enter it as a positive number."
                : "What's in the account right now. Everything you record moves it from here."}
            </p>
          </div>
        ) : (
          <p className="text-sm text-ink-soft">
            Balance is {account.current_balance < 0 ? "−" : ""}₹{Math.abs(account.current_balance).toLocaleString("en-IN")}.
            To correct it, use <strong>Set balance</strong> on the account page — that records an
            adjustment so the change stays traceable.
          </p>
        )}

        {isCard ? (
          <>
            <div>
              <label className="label" htmlFor="limit">
                Credit limit <span className="normal-case">(optional)</span>
              </label>
              <input id="limit" type="number" className="field tnum" value={limit}
                onChange={(e) => setLimit(e.target.value)} placeholder="200000" />
            </div>
            <div>
              <label className="label" htmlFor="cycle">
                Statement day <span className="normal-case">(optional)</span>
              </label>
              <input id="cycle" type="number" min={1} max={28} className="field tnum" value={cycleDay}
                onChange={(e) => setCycleDay(e.target.value)} placeholder="18" />
            </div>
          </>
        ) : null}

        <div>
          <span className="label">Colour</span>
          <div className="flex flex-wrap gap-2">
            {SWATCHES.map((s) => (
              <button key={s} type="button" onClick={() => setColor(s)}
                aria-label={`Use colour ${s}`} aria-pressed={color === s}
                className="h-9 w-9 rounded-full border-2 transition-transform"
                style={{ background: s, borderColor: color === s ? "var(--ink)" : "transparent",
                  transform: color === s ? "scale(1.06)" : undefined }} />
            ))}
          </div>
        </div>
      </section>

      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

      <div className="flex gap-3">
        <button type="submit" className="btn btn-primary flex-1" disabled={pending}>
          {pending ? "Saving…" : account ? "Save changes" : "Add account"}
        </button>
        <Link href="/accounts" className="btn btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}
