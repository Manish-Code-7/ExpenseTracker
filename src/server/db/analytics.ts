import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { accounts, categories, transactions } from "@/server/db/schema";
import {
  isLiability,
  outstandingOf,
  round2,
  type AccountType,
} from "@/lib/financial";

/**
 * Reporting.
 *
 * The rule that shapes every query here: spending totals come from the
 * transaction *type*, never from a balance difference. `opening - current`
 * would sweep in transfers, withdrawals, card payments and income, which is
 * exactly the double-counting the financial model exists to prevent (§22).
 *
 * Net spend is EXPENSE minus REFUND. TRANSFER, CASH_WITHDRAWAL,
 * CREDIT_CARD_PAYMENT and ADJUSTMENT never appear in a spending figure.
 */

/** EXPENSE positive, REFUND negative, everything else zero — in SQL. */
const netSpend = sql<number>`coalesce(sum(
  case ${transactions.type}
    when 'EXPENSE' then ${transactions.amount}
    when 'REFUND'  then -${transactions.amount}
    else 0
  end
), 0)::float8`;

const incomeSum = sql<number>`coalesce(sum(
  case when ${transactions.type} = 'INCOME' then ${transactions.amount} else 0 end
), 0)::float8`;

type Range = { from: string; to: string };

const inRange = (userId: string, range: Range) =>
  and(
    eq(transactions.user_id, userId),
    gte(transactions.date, range.from),
    lte(transactions.date, range.to),
  );

export async function getTotals(userId: string, range: Range) {
  const [row] = await db
    .select({ spend: netSpend, income: incomeSum })
    .from(transactions)
    .where(inRange(userId, range));

  const spend = round2(row?.spend ?? 0);
  const income = round2(row?.income ?? 0);
  return { spend, income, netCashFlow: round2(income - spend) };
}

/** Balances, outstanding, and net worth — assets minus liabilities. */
export async function getAccountsOverview(userId: string) {
  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.user_id, userId))
    .orderBy(desc(accounts.is_active), asc(accounts.created_at));

  const enriched = rows.map((a) => ({
    ...a,
    type: a.type as AccountType,
    outstanding: outstandingOf(a.type as AccountType, a.current_balance),
    isLiability: isLiability(a.type as AccountType),
  }));

  const assets = round2(
    enriched.filter((a) => !a.isLiability).reduce((n, a) => n + a.current_balance, 0),
  );
  const liabilities = round2(
    enriched.filter((a) => a.isLiability).reduce((n, a) => n + a.outstanding, 0),
  );

  return {
    accounts: enriched,
    assets,
    liabilities,
    // Signed balances, so this is simply the sum.
    netWorth: round2(assets - liabilities),
    availableCash: round2(
      enriched.filter((a) => a.type === "CASH").reduce((n, a) => n + a.current_balance, 0),
    ),
    creditOutstanding: round2(
      enriched.filter((a) => a.type === "CREDIT_CARD").reduce((n, a) => n + a.outstanding, 0),
    ),
  };
}

/** Spend per top-level category. Internal movements are excluded by netSpend. */
export async function getCategoryBreakdown(userId: string, range: Range) {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      total: netSpend,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.category_id))
    .where(inRange(userId, range))
    .groupBy(categories.id, categories.name);

  return rows
    .map((r) => ({
      id: r.id ?? "__uncategorised",
      name: r.name ?? "Uncategorised",
      total: round2(r.total),
    }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
}

export async function getPaymentMethodBreakdown(userId: string, range: Range) {
  const rows = await db
    .select({ method: transactions.payment_method, total: netSpend })
    .from(transactions)
    .where(inRange(userId, range))
    .groupBy(transactions.payment_method);

  return rows
    .map((r) => ({ method: r.method ?? "OTHER", total: round2(r.total) }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
}

/** Spend attributed to the account it came out of. */
export async function getAccountBreakdown(userId: string, range: Range) {
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      color_tag: accounts.color_tag,
      total: netSpend,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.source_account_id))
    .where(inRange(userId, range))
    .groupBy(accounts.id, accounts.name, accounts.color_tag);

  return rows
    .filter((r) => r.id !== null)
    .map((r) => ({
      id: r.id!,
      name: r.name ?? "Removed account",
      color: r.color_tag ?? "#94a3b8",
      total: round2(r.total),
    }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
}

/** Income vs expense per month, for the cash-flow chart. */
export async function getCashFlowSeries(userId: string, months = 6) {
  const rows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${transactions.date}), 'YYYY-MM')`,
      spend: netSpend,
      income: incomeSum,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, userId),
        gte(transactions.date, sql`(current_date - make_interval(months => ${months}))`),
      ),
    )
    .groupBy(sql`date_trunc('month', ${transactions.date})`)
    .orderBy(sql`date_trunc('month', ${transactions.date})`);

  return rows.map((r) => ({
    month: r.month,
    spend: round2(r.spend),
    income: round2(r.income),
    net: round2(r.income - r.spend),
  }));
}

/** How much of an expense has already been refunded. */
export async function getRefundedTotals(userId: string, transactionIds: string[]) {
  if (transactionIds.length === 0) return new Map<string, number>();

  const rows = await db
    .select({
      linked: transactions.linked_transaction_id,
      total: sql<number>`coalesce(sum(${transactions.amount}), 0)::float8`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, userId),
        eq(transactions.type, "REFUND"),
        sql`${transactions.linked_transaction_id} = any(${transactionIds})`,
      ),
    )
    .groupBy(transactions.linked_transaction_id);

  return new Map(rows.filter((r) => r.linked).map((r) => [r.linked!, round2(r.total)]));
}
