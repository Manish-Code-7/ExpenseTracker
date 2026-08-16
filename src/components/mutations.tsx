"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc, errorText } from "@/lib/trpc";

/**
 * The small write buttons scattered across the server-rendered screens.
 *
 * Each is a client island calling a tRPC mutation, then `router.refresh()` so
 * the surrounding server components re-render with the new data — the same
 * effect the Server Action forms had, without making a whole page interactive.
 */

function Button({
  children,
  onClick,
  pending,
  className,
  confirm,
  title,
  pendingLabel = "Working…",
}: {
  children: React.ReactNode;
  onClick: () => void;
  pending: boolean;
  className: string;
  confirm?: string;
  title?: string;
  pendingLabel?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={pending}
      className={className}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        onClick();
      }}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

function useRefresh() {
  const router = useRouter();
  return {
    onSuccess: () => router.refresh(),
    onError: (error: unknown) => window.alert(errorText(error)),
  };
}

export function DeleteTransactionButton({
  id,
  className,
  children = "Delete",
  redirectTo,
}: {
  id: string;
  className: string;
  children?: React.ReactNode;
  redirectTo?: string;
}) {
  const router = useRouter();
  const mutation = trpc.transactions.delete.useMutation({
    onSuccess: () => {
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    },
    onError: (error: unknown) => window.alert(errorText(error)),
  });

  return (
    <Button
      className={className}
      pending={mutation.isPending}
      confirm="Delete this transaction? Balances will be corrected."
      onClick={() => mutation.mutate({ id })}
    >
      {children}
    </Button>
  );
}

export function ToggleAccountButton({
  id,
  isActive,
  className,
  children,
}: {
  id: string;
  /** The state to move to. */
  isActive: boolean;
  className: string;
  children: React.ReactNode;
}) {
  const mutation = trpc.accounts.setActive.useMutation(useRefresh());

  return (
    <Button
      className={className}
      pending={mutation.isPending}
      onClick={() => mutation.mutate({ id, isActive })}
    >
      {children}
    </Button>
  );
}

export function DeleteAccountButton({
  id,
  className,
  children = "Remove account",
}: {
  id: string;
  className: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const mutation = trpc.accounts.delete.useMutation({
    onSuccess: () => {
      router.push("/accounts");
      router.refresh();
    },
    onError: (error: unknown) => window.alert(errorText(error)),
  });

  return (
    <Button
      className={className}
      pending={mutation.isPending}
      confirm="Remove this account? If any transactions use it, it's archived instead so your history stays intact."
      onClick={() => mutation.mutate({ id })}
    >
      {children}
    </Button>
  );
}

export function RecurringButton({
  id,
  action,
  className,
  children,
}: {
  id: string;
  action: "confirm" | "dismiss" | "reset";
  className: string;
  children: React.ReactNode;
}) {
  const refresh = useRefresh();
  const confirmM = trpc.recurring.confirm.useMutation(refresh);
  const dismissM = trpc.recurring.dismiss.useMutation(refresh);
  const resetM = trpc.recurring.reset.useMutation(refresh);

  const mutation =
    action === "confirm" ? confirmM : action === "dismiss" ? dismissM : resetM;

  return (
    <Button
      className={className}
      pending={mutation.isPending}
      onClick={() => mutation.mutate({ id })}
    >
      {children}
    </Button>
  );
}

export function RescanButton({ className }: { className: string }) {
  const mutation = trpc.recurring.rescan.useMutation(useRefresh());

  return (
    <Button
      className={className}
      pending={mutation.isPending}
      pendingLabel="Scanning…"
      onClick={() => mutation.mutate()}
    >
      Rescan
    </Button>
  );
}

/**
 * Reconciles an account to a stated balance. The difference becomes an
 * ADJUSTMENT transaction rather than a silent write, so the correction is
 * visible in the ledger like everything else.
 */
export function AdjustBalance({
  accountId,
  current,
  isLiability,
}: {
  accountId: string;
  current: number;
  isLiability: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(isLiability ? Math.abs(current) : current));
  const [note, setNote] = useState("");

  const adjust = trpc.accounts.adjustBalance.useMutation({
    onSuccess: (r) => {
      if (!r.adjusted) window.alert("That's already the balance — nothing to adjust.");
      router.refresh();
    },
    onError: (error: unknown) => window.alert(errorText(error)),
  });

  return (
    <div className="mt-3 space-y-3">
      <div>
        <label className="label" htmlFor="target">
          {isLiability ? "Actually owed" : "Actual balance"}
        </label>
        <input
          id="target"
          type="number"
          step="0.01"
          className="field tnum"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor="adjust-note">
          Note <span className="normal-case">(optional)</span>
        </label>
        <input
          id="adjust-note"
          className="field"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Counted my wallet"
        />
      </div>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={adjust.isPending}
        onClick={() => {
          const n = Number(value);
          if (!Number.isFinite(n)) return window.alert("Enter a number.");
          adjust.mutate({
            accountId,
            // A liability's balance is held negative internally.
            targetBalance: isLiability ? -Math.abs(n) : n,
            date: new Date().toISOString().slice(0, 10),
            notes: note.trim() || null,
          });
        }}
      >
        {adjust.isPending ? "Adjusting…" : "Set balance"}
      </button>
    </div>
  );
}
