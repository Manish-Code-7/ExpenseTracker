import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { accounts, ingestedItems, transactions } from "@/server/db/schema";
import { createTransaction } from "@/server/db/transaction-service";
import { assignMatches, fingerprint, type Candidate, type Existing } from "@/lib/matching";
import { parseStatementCsv } from "@/lib/statement-csv";
import { addDaysISO } from "@/lib/dates";
import { loadRules, matchRule } from "@/server/db/merchant-rules";
import type { AccountType, TransactionType } from "@/lib/financial";

/**
 * Bringing outside records into the ledger.
 *
 * Nothing here writes a transaction directly — confirmed rows go through the
 * same transaction service the UI and the assistant use, so the financial
 * rules, validation and atomicity apply identically no matter where a record
 * came from.
 *
 * The flow is deliberately two-step: stage everything, let the user look, then
 * commit. A wrong auto-import silently corrupts balances, and unpicking that
 * later is far worse than one review screen now.
 */

/** How far either side of the statement range to look for existing matches. */
const MATCH_WINDOW_DAYS = 5;

export type StagedItem = {
  id: string;
  date: string;
  amount: number;
  merchant: string | null;
  raw: string;
  type: TransactionType;
  suggestedCategoryId: string | null;
  status: "PENDING" | "IMPORTED" | "IGNORED" | "DUPLICATE";
  matchedTransactionId: string | null;
  matchReason: string | null;
};

export type StageResult = {
  staged: StagedItem[];
  /** Rows already seen in a previous upload of the same statement. */
  alreadyImported: number;
  /** Rows that look like something the user entered by hand. */
  likelyTracked: number;
  /** Genuinely new rows, awaiting confirmation. */
  fresh: number;
  skipped: { line: number; reason: string }[];
};

/**
 * What money moving in or out of this account means, financially.
 *
 * On a bank account, money out is spending and money in is income. On a credit
 * card the polarity inverts: a charge increases what you owe (an expense on the
 * card) and a credit is money coming back. Getting this wrong would invert
 * every card statement, so it is decided here rather than guessed per row.
 */
function classify(accountType: AccountType, outgoing: boolean): TransactionType {
  if (accountType === "CREDIT_CARD") return outgoing ? "EXPENSE" : "REFUND";
  return outgoing ? "EXPENSE" : "INCOME";
}

/** A record from any source, ready to be checked against the ledger. */
export type IncomingRecord = {
  date: string;
  amount: number;
  outgoing: boolean;
  description: string;
  merchant: string;
  reference?: string | null;
  raw: string;
};

/**
 * Check incoming records against the ledger and stage whatever is new.
 *
 * Shared by every source — statements now, email and SMS next — because the
 * hard parts (recognising what we have already seen, spotting what the user
 * entered by hand, suggesting a category) are identical no matter where the
 * record came from. Only parsing differs.
 */
export async function stageRecords(
  userId: string,
  accountId: string,
  source: "STATEMENT" | "EMAIL" | "SMS",
  records: IncomingRecord[],
): Promise<StageResult> {
  const [account] = await db
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.user_id, userId)))
    .limit(1);

  if (!account) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Account not found." });
  }
  if (records.length === 0) {
    return { staged: [], alreadyImported: 0, likelyTracked: 0, fresh: 0, skipped: [] };
  }

  const accountType = account.type as AccountType;

  // 1. Fingerprint everything, and drop what we have already seen.
  const withRefs = records.map((row) => ({
    row,
    ref: fingerprint({
      accountId,
      date: row.date,
      amount: row.amount,
      description: row.description,
      reference: row.reference,
    }),
  }));

  const refs = withRefs.map((r) => r.ref);
  const [seenItems, seenTransactions] = await Promise.all([
    db
      .select({ external_ref: ingestedItems.external_ref })
      .from(ingestedItems)
      .where(and(eq(ingestedItems.user_id, userId), inArray(ingestedItems.external_ref, refs))),
    db
      .select({ external_ref: transactions.external_ref })
      .from(transactions)
      .where(and(eq(transactions.user_id, userId), inArray(transactions.external_ref, refs))),
  ]);

  const seen = new Set([
    ...seenItems.map((r) => r.external_ref),
    ...seenTransactions.map((r) => r.external_ref!),
  ]);
  const incoming = withRefs.filter((r) => !seen.has(r.ref));

  if (incoming.length === 0) {
    return {
      staged: [],
      alreadyImported: withRefs.length,
      likelyTracked: 0,
      fresh: 0,
      skipped: [],
    };
  }

  // 2. Fuzzy-match the rest against transactions entered by hand.
  const dates = incoming.map((r) => r.row.date).sort();
  const existingRows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      merchant: transactions.merchant,
      description: transactions.description,
      type: transactions.type,
      source_account_id: transactions.source_account_id,
      destination_account_id: transactions.destination_account_id,
      external_ref: transactions.external_ref,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, userId),
        gte(transactions.date, addDaysISO(dates[0], -MATCH_WINDOW_DAYS)),
        lte(transactions.date, addDaysISO(dates[dates.length - 1], MATCH_WINDOW_DAYS)),
      ),
    );

  const candidates: Candidate[] = incoming.map(({ row, ref }) => ({
    id: ref,
    accountId,
    date: row.date,
    amount: row.amount,
    merchant: row.merchant || row.description,
    type: classify(accountType, row.outgoing),
  }));

  const existing: Existing[] = existingRows.map((t) => ({
    id: t.id,
    // Money out sits on the source side, money in on the destination.
    accountId: t.source_account_id ?? t.destination_account_id,
    date: t.date,
    amount: t.amount,
    merchant: t.merchant ?? t.description ?? "",
    type: t.type as TransactionType,
    hasReference: Boolean(t.external_ref),
  }));

  const { matched } = assignMatches(candidates, existing);
  const matchByRef = new Map(matched.map((m) => [m.candidateId, m]));

  // 3. Suggest categories from the user's own rules.
  const rules = await loadRules(userId);

  const values = incoming.map(({ row, ref }) => {
    const match = matchByRef.get(ref);
    return {
      user_id: userId,
      source,
      external_ref: ref,
      account_id: accountId,
      raw_text: row.raw,
      parsed_amount: row.amount,
      parsed_date: row.date,
      parsed_merchant: row.merchant || null,
      suggested_type: classify(accountType, row.outgoing),
      suggested_category_id: matchRule(rules, row.merchant)?.category_id ?? null,
      status: match ? ("DUPLICATE" as const) : ("PENDING" as const),
      matched_transaction_id: match?.existingId ?? null,
      match_reason: match?.reason ?? null,
    };
  });

  const inserted = await db
    .insert(ingestedItems)
    .values(values)
    .onConflictDoNothing({ target: [ingestedItems.user_id, ingestedItems.external_ref] })
    .returning();

  return {
    staged: inserted.map(toStagedItem),
    alreadyImported: withRefs.length - incoming.length,
    likelyTracked: inserted.filter((i) => i.status === "DUPLICATE").length,
    fresh: inserted.filter((i) => i.status === "PENDING").length,
    skipped: [],
  };
}

/** Parse a bank CSV and stage whatever is new. */
export async function stageStatement(
  userId: string,
  accountId: string,
  csv: string,
): Promise<StageResult> {
  const parsed = parseStatementCsv(csv);
  if (parsed.rows.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        parsed.skipped[0]?.reason ??
        "No transactions found in that file. Is it a bank statement export?",
    });
  }

  const result = await stageRecords(userId, accountId, "STATEMENT", parsed.rows);
  return { ...result, skipped: parsed.skipped.map((s) => ({ line: s.line, reason: s.reason })) };
}

function toStagedItem(row: typeof ingestedItems.$inferSelect): StagedItem {
  return {
    id: row.id,
    date: row.parsed_date,
    amount: row.parsed_amount,
    merchant: row.parsed_merchant,
    raw: row.raw_text,
    type: row.suggested_type as TransactionType,
    suggestedCategoryId: row.suggested_category_id,
    status: row.status as StagedItem["status"],
    matchedTransactionId: row.matched_transaction_id,
    matchReason: row.match_reason,
  };
}

/** Everything still awaiting a decision, oldest first. */
export async function listPending(userId: string): Promise<StagedItem[]> {
  const rows = await db
    .select()
    .from(ingestedItems)
    .where(
      and(
        eq(ingestedItems.user_id, userId),
        inArray(ingestedItems.status, ["PENDING", "DUPLICATE"]),
      ),
    )
    .orderBy(asc(ingestedItems.parsed_date));
  return rows.map(toStagedItem);
}

/**
 * Commit chosen rows into the ledger.
 *
 * Each becomes a real transaction through the normal service, carrying its
 * fingerprint so a future upload of the same statement resolves exactly.
 */
export async function confirmItems(
  userId: string,
  choices: { id: string; categoryId?: string | null }[],
) {
  if (choices.length === 0) return { imported: 0 };

  const ids = choices.map((c) => c.id);
  const rows = await db
    .select()
    .from(ingestedItems)
    .where(and(eq(ingestedItems.user_id, userId), inArray(ingestedItems.id, ids)));

  const overrides = new Map(choices.map((c) => [c.id, c.categoryId]));
  let imported = 0;

  for (const row of rows) {
    if (row.status === "IMPORTED" || row.status === "IGNORED") continue;

    const type = row.suggested_type as TransactionType;
    const categoryId =
      overrides.get(row.id) !== undefined
        ? overrides.get(row.id)
        : row.suggested_category_id;

    const created = await createTransaction(userId, {
      type,
      amount: row.parsed_amount,
      // Money out leaves the account; money in arrives at it.
      source_account_id: type === "EXPENSE" ? row.account_id : null,
      destination_account_id: type === "EXPENSE" ? null : row.account_id,
      category_id: type === "EXPENSE" ? (categoryId ?? null) : null,
      payment_method: null,
      date: row.parsed_date,
      merchant: row.parsed_merchant,
      description: null,
      notes: null,
      external_ref: row.external_ref,
      created_by: "import",
    });

    await db
      .update(ingestedItems)
      .set({ status: "IMPORTED", transaction_id: created.id })
      .where(eq(ingestedItems.id, row.id));

    imported++;
  }

  return { imported };
}

/**
 * Dismiss rows the user does not want imported.
 *
 * When a row was matched to an existing transaction, dismissing it also writes
 * the fingerprint onto that transaction — the ledger learns the bank's identity
 * for a record the user typed by hand, so the next statement matches it exactly
 * instead of guessing again.
 */
export async function ignoreItems(userId: string, ids: string[]) {
  if (ids.length === 0) return { ignored: 0 };

  const rows = await db
    .select()
    .from(ingestedItems)
    .where(and(eq(ingestedItems.user_id, userId), inArray(ingestedItems.id, ids)));

  for (const row of rows) {
    if (row.matched_transaction_id) {
      await db
        .update(transactions)
        .set({ external_ref: row.external_ref })
        .where(
          and(
            eq(transactions.id, row.matched_transaction_id),
            eq(transactions.user_id, userId),
            sql`${transactions.external_ref} is null`,
          ),
        );
    }
  }

  await db
    .update(ingestedItems)
    .set({ status: "IGNORED" })
    .where(and(eq(ingestedItems.user_id, userId), inArray(ingestedItems.id, ids)));

  return { ignored: rows.length };
}

/**
 * Read recent bank alerts from Gmail and stage whatever is new.
 *
 * Alerts the parser cannot read confidently are counted and reported rather
 * than guessed at — a wrong amount on someone's ledger is worse than a row
 * they enter themselves.
 */
export async function stageFromEmail(
  userId: string,
  accountId: string,
  headers: Headers,
  sinceDays = 30,
): Promise<StageResult & { unreadable: number; scanned: number }> {
  const { fetchBankMail } = await import("@/server/chat/gmail");
  const { parseBankAlert, isNotATransaction } = await import("@/lib/bank-alert");

  const messages = await fetchBankMail(userId, headers, sinceDays);

  const records: IncomingRecord[] = [];
  let unreadable = 0;

  for (const message of messages) {
    if (isNotATransaction(message.text)) continue;

    const alert = parseBankAlert(message.text);
    if (!alert) {
      unreadable++;
      continue;
    }

    records.push({
      // The alert's own date is more accurate than when the mail arrived,
      // but the mail's date is a sound fallback.
      date: alert.date ?? message.date,
      amount: alert.amount,
      outgoing: alert.outgoing,
      description: alert.description,
      merchant: alert.merchant,
      // Gmail's message id makes re-syncing the same alert a no-op.
      reference: `gmail:${message.id}`,
      raw: message.text.slice(0, 2000),
    });
  }

  const result = await stageRecords(userId, accountId, "EMAIL", records);
  return { ...result, unreadable, scanned: messages.length };
}

/**
 * Work out which account an alert is about, from the digits it quotes.
 *
 * Alerts almost always name the account — "a/c XX4321", "Card ending 8812" —
 * and accounts store their last four, so the routing is usually unambiguous
 * without asking. When it isn't, the caller falls back to a chosen default
 * rather than picking one at random.
 */
export async function resolveAccountByLast4(
  userId: string,
  last4: string | null,
): Promise<string | null> {
  if (!last4) return null;

  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.user_id, userId),
        eq(accounts.is_active, true),
        eq(accounts.account_number_last4, last4),
      ),
    );

  // Two accounts sharing the last four digits is rare but possible; guessing
  // between them would put money in the wrong place.
  return rows.length === 1 ? rows[0].id : null;
}

/**
 * Take one forwarded SMS and stage it if it is a transaction.
 *
 * Returns why nothing was staged when that is the case, so the webhook can
 * answer honestly rather than silently accepting everything.
 */
export async function stageSms(
  userId: string,
  text: string,
  sender: string,
  fallbackAccountId: string | null,
  receivedAt?: string,
): Promise<{ staged: boolean; reason?: string; accountId?: string }> {
  const { parseBankAlert, isNotATransaction } = await import("@/lib/bank-alert");

  if (isNotATransaction(text)) return { staged: false, reason: "not a transaction" };

  const alert = parseBankAlert(text);
  if (!alert) return { staged: false, reason: "could not read the alert" };

  const accountId =
    (await resolveAccountByLast4(userId, alert.last4)) ?? fallbackAccountId;
  if (!accountId) {
    return {
      staged: false,
      reason: alert.last4
        ? `no account ends in ${alert.last4}`
        : "the alert names no account, and no default is set",
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const result = await stageRecords(userId, accountId, "SMS", [
    {
      date: alert.date ?? receivedAt?.slice(0, 10) ?? today,
      amount: alert.amount,
      outgoing: alert.outgoing,
      description: alert.description,
      merchant: alert.merchant,
      // The message text itself is the identity — the same alert forwarded
      // twice hashes the same and is ignored.
      reference: null,
      raw: text.slice(0, 2000),
    },
  ]);

  return {
    staged: result.fresh + result.likelyTracked > 0,
    reason: result.alreadyImported > 0 ? "already seen" : undefined,
    accountId,
  };
}
