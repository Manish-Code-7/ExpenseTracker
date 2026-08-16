import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, type Tx } from "@/server/db";
import { accounts, transactions } from "@/server/db/schema";
import {
  looksDuplicate,
  movementsFor,
  reverseMovements,
  round2,
  validateTransaction,
  type AccountType,
  type Movement,
  type TransactionType,
} from "@/lib/financial";

/**
 * The single place money moves.
 *
 * Nothing else in the app may write `transactions` or touch
 * `accounts.current_balance` — routes and the chatbot both come through here,
 * so the financial rules can't be bypassed or reimplemented differently in two
 * places. Every write runs inside a database transaction, so a multi-account
 * operation either fully succeeds or leaves nothing behind (invariant 9).
 */

export type TransactionInput = {
  type: TransactionType;
  amount: number;
  source_account_id?: string | null;
  destination_account_id?: string | null;
  category_id?: string | null;
  subcategory_id?: string | null;
  payment_method?: string | null;
  date: string;
  description?: string | null;
  merchant?: string | null;
  notes?: string | null;
  linked_transaction_id?: string | null;
  created_by?: string;
};

function fail(message: string, code: TRPCError["code"] = "BAD_REQUEST"): never {
  throw new TRPCError({ code, message });
}

/** Loads the user's accounts as the validator wants them. */
async function loadAccounts(tx: Tx | typeof db, userId: string) {
  const rows = await tx
    .select({
      id: accounts.id,
      type: accounts.type,
      user_id: accounts.user_id,
      name: accounts.name,
      current_balance: accounts.current_balance,
    })
    .from(accounts)
    .where(eq(accounts.user_id, userId));

  return new Map(
    rows.map((r) => [
      r.id,
      { ...r, type: r.type as AccountType },
    ]),
  );
}

/** Applies signed deltas to account balances inside an open transaction. */
async function applyMovements(tx: Tx, movements: Movement[]) {
  for (const movement of movements) {
    if (movement.delta === 0) continue;
    await tx
      .update(accounts)
      .set({
        current_balance: sql`${accounts.current_balance} + ${movement.delta}`,
        updated_at: new Date().toISOString(),
      })
      .where(eq(accounts.id, movement.accountId));
  }
}

/** Rejects anything the financial rules disallow, with a user-facing message. */
async function assertValid(
  tx: Tx | typeof db,
  userId: string,
  input: TransactionInput,
) {
  const accountMap = await loadAccounts(tx, userId);
  const error = validateTransaction({
    type: input.type,
    amount: input.amount,
    source_account_id: input.source_account_id,
    destination_account_id: input.destination_account_id,
    accounts: accountMap,
    userId,
  });
  if (error) fail(error);
  return accountMap;
}

/**
 * Refunds should point at the purchase they reverse, and may not exceed it.
 * Partial and repeated refunds are fine; over-refunding is not.
 *
 * A linked refund also inherits the original's category unless one was given.
 * Without that the refund's negative amount lands under "Uncategorised" and
 * the category it actually reverses keeps reporting the full pre-refund total —
 * the totals stay right while the breakdown silently over-reports.
 */
async function assertRefundIsSane(
  tx: Tx | typeof db,
  userId: string,
  input: TransactionInput,
  ignoreId?: string,
) {
  if (input.type !== "REFUND" || !input.linked_transaction_id) return;

  const [original] = await tx
    .select({
      id: transactions.id,
      amount: transactions.amount,
      type: transactions.type,
      category_id: transactions.category_id,
      subcategory_id: transactions.subcategory_id,
      merchant: transactions.merchant,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.id, input.linked_transaction_id),
        eq(transactions.user_id, userId),
      ),
    )
    .limit(1);

  if (!original) fail("The transaction being refunded could not be found.", "NOT_FOUND");
  if (original.type !== "EXPENSE") fail("Only an expense can be refunded.");

  const prior = await tx
    .select({ amount: transactions.amount, id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, userId),
        eq(transactions.type, "REFUND"),
        eq(transactions.linked_transaction_id, original.id),
      ),
    );

  const already = prior
    .filter((r) => r.id !== ignoreId)
    .reduce((sum, r) => sum + r.amount, 0);

  if (round2(already + input.amount) > original.amount) {
    fail(
      `That would refund more than the original ₹${original.amount}. ` +
        `₹${round2(already)} has already been refunded.`,
    );
  }

  // Mutating the caller's input is deliberate: both write paths call this
  // immediately before building their row, so the inheritance applies once.
  if (!input.category_id) {
    input.category_id = original.category_id;
    input.subcategory_id = input.subcategory_id ?? original.subcategory_id;
  }
  if (!input.merchant) input.merchant = original.merchant;
}

/** Recent near-identical rows, so the caller can warn without blocking. */
export async function findPossibleDuplicate(
  userId: string,
  input: TransactionInput,
) {
  const recent = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.user_id, userId), eq(transactions.date, input.date)))
    .limit(50);

  const candidate = { ...input, created_at: new Date() };
  return (
    recent.find((row) =>
      looksDuplicate(
        {
          type: row.type as TransactionType,
          amount: row.amount,
          source_account_id: row.source_account_id,
          destination_account_id: row.destination_account_id,
          category_id: row.category_id,
          created_at: row.created_at,
        },
        {
          type: candidate.type,
          amount: candidate.amount,
          source_account_id: candidate.source_account_id ?? null,
          destination_account_id: candidate.destination_account_id ?? null,
          category_id: candidate.category_id ?? null,
          created_at: candidate.created_at,
        },
      ),
    ) ?? null
  );
}

/* --- the three write paths ------------------------------------------------ */

export async function createTransaction(userId: string, input: TransactionInput) {
  return db.transaction(async (tx) => {
    await assertValid(tx, userId, input);
    await assertRefundIsSane(tx, userId, input);

    const [row] = await tx
      .insert(transactions)
      .values({
        user_id: userId,
        type: input.type,
        amount: input.amount,
        source_account_id: input.source_account_id ?? null,
        destination_account_id: input.destination_account_id ?? null,
        category_id: input.category_id ?? null,
        subcategory_id: input.subcategory_id ?? null,
        payment_method: (input.payment_method ?? null) as never,
        date: input.date,
        description: input.description ?? null,
        merchant: input.merchant ?? null,
        notes: input.notes ?? null,
        linked_transaction_id: input.linked_transaction_id ?? null,
        // Both sides live on one row, so the id doubles as the group key.
        transfer_id: null,
        created_by: input.created_by ?? "user",
      })
      .returning();

    await applyMovements(tx, movementsFor(row));
    return row;
  });
}

/**
 * Edits reverse the old movements and apply the new ones in the same database
 * transaction, so an edit that changes accounts can never leave one side stale.
 */
export async function updateTransaction(
  userId: string,
  id: string,
  input: TransactionInput,
) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.user_id, userId)))
      .limit(1);

    if (!existing) fail("That transaction is gone.", "NOT_FOUND");

    await assertValid(tx, userId, input);
    await assertRefundIsSane(tx, userId, input, id);

    // Undo the old effect before applying the new one.
    await applyMovements(tx, reverseMovements(existing));

    const [row] = await tx
      .update(transactions)
      .set({
        type: input.type,
        amount: input.amount,
        source_account_id: input.source_account_id ?? null,
        destination_account_id: input.destination_account_id ?? null,
        category_id: input.category_id ?? null,
        subcategory_id: input.subcategory_id ?? null,
        payment_method: (input.payment_method ?? null) as never,
        date: input.date,
        description: input.description ?? null,
        merchant: input.merchant ?? null,
        notes: input.notes ?? null,
        linked_transaction_id: input.linked_transaction_id ?? null,
        updated_at: new Date().toISOString(),
      })
      .where(eq(transactions.id, id))
      .returning();

    await applyMovements(tx, movementsFor(row));
    return row;
  });
}

export async function deleteTransaction(userId: string, id: string) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.user_id, userId)))
      .limit(1);

    if (!existing) fail("That transaction is gone.", "NOT_FOUND");

    // Refunds attached to this expense would otherwise be orphaned.
    const dependents = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.user_id, userId),
          eq(transactions.linked_transaction_id, id),
        ),
      );

    if (dependents.length > 0) {
      fail(
        `This has ${dependents.length} refund${dependents.length === 1 ? "" : "s"} attached. ` +
          "Delete those first.",
      );
    }

    await applyMovements(tx, reverseMovements(existing));
    await tx.delete(transactions).where(eq(transactions.id, id));
    return { id };
  });
}

/**
 * Sets an account to a stated balance by recording the difference as an
 * ADJUSTMENT — never by writing the balance directly, so the change stays
 * traceable in the ledger (§17, §67).
 */
export async function adjustAccountBalance(
  userId: string,
  accountId: string,
  targetBalance: number,
  date: string,
  notes?: string,
) {
  return db.transaction(async (tx) => {
    const accountMap = await loadAccounts(tx, userId);
    const account = accountMap.get(accountId);
    if (!account) fail("Account not found.", "NOT_FOUND");

    const delta = round2(targetBalance - account.current_balance);
    if (delta === 0) return null;

    const [row] = await tx
      .insert(transactions)
      .values({
        user_id: userId,
        type: "ADJUSTMENT",
        amount: delta,
        destination_account_id: accountId,
        date,
        description: `Balance set to ${targetBalance}`,
        notes: notes ?? null,
        created_by: "user",
      })
      .returning();

    await applyMovements(tx, movementsFor(row));
    return row;
  });
}

/** Recomputes balances from history — a repair tool, not a hot path. */
export async function recomputeBalances(userId: string) {
  return db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: accounts.id, opening_balance: accounts.opening_balance })
      .from(accounts)
      .where(eq(accounts.user_id, userId));

    const totals = new Map(owned.map((a) => [a.id, a.opening_balance]));

    const rows = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.user_id, userId));

    for (const row of rows) {
      for (const movement of movementsFor(row)) {
        totals.set(
          movement.accountId,
          round2((totals.get(movement.accountId) ?? 0) + movement.delta),
        );
      }
    }

    for (const [id, balance] of totals) {
      await tx
        .update(accounts)
        .set({ current_balance: balance, updated_at: new Date().toISOString() })
        .where(and(eq(accounts.id, id), eq(accounts.user_id, userId)));
    }

    return Object.fromEntries(totals);
  });
}
