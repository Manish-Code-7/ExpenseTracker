"use client";

import { useState } from "react";
import { trpc, errorText } from "@/lib/trpc";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/financial";

const TYPE_LABEL: Record<AccountType, string> = {
  BANK: "Bank account",
  CREDIT_CARD: "Credit card",
  CASH: "Cash",
  OTHER_ASSET: "Other asset",
  OTHER_LIABILITY: "Other liability",
};

/**
 * Add an account without leaving the form you're in.
 *
 * Realising mid-entry that the card you paid with isn't set up shouldn't cost
 * you the amount, date and note you already typed. This creates the account in
 * place and hands the id straight back to the field that needed it.
 */
export function QuickAddAccount({
  onCreated,
  onCancel,
  suggestType,
}: {
  onCreated: (account: { id: string; name: string; type: AccountType }) => void;
  onCancel: () => void;
  suggestType?: AccountType;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>(suggestType ?? "BANK");
  const [balance, setBalance] = useState("0");
  const [error, setError] = useState<string | null>(null);

  const create = trpc.accounts.create.useMutation({
    onSuccess: (r) => onCreated({ id: r.id, name: name.trim(), type }),
    onError: (e) => setError(errorText(e)),
  });

  const isCard = type === "CREDIT_CARD";

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-line-strong p-3">
      <div>
        <label className="label" htmlFor="qa-name">Account name</label>
        <input
          id="qa-name"
          className="field"
          autoFocus
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={isCard ? "HDFC Millennia" : "SBI Savings"}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="qa-type">Type</label>
          <select
            id="qa-type"
            className="field"
            value={type}
            onChange={(e) => setType(e.target.value as AccountType)}
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>{TYPE_LABEL[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="qa-balance">
            {isCard ? "Owed now" : "Balance now"}
          </label>
          <input
            id="qa-balance"
            type="number"
            step="0.01"
            className="field tnum"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
        </div>
      </div>

      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-secondary h-9 min-h-9 flex-1 text-sm"
          disabled={create.isPending}
          onClick={() => {
            setError(null);
            if (name.trim().length === 0) return setError("Give the account a name.");
            const n = Number(balance || 0);
            if (!Number.isFinite(n)) return setError("Balance must be a number.");
            create.mutate({
              name: name.trim(),
              type,
              // A card's balance is what you owe, held negative internally.
              opening_balance: isCard ? -Math.abs(n) : n,
              institution_name: null,
              account_number_last4: null,
              credit_limit: null,
              billing_cycle_day: null,
              color_tag: "#6366f1",
            });
          }}
        >
          {create.isPending ? "Adding…" : "Add and use it"}
        </button>
        <button
          type="button"
          className="btn btn-ghost h-9 min-h-9 px-3 text-sm"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
