import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { accounts, transactions } from "@/server/db/schema";
import { createTransaction, findPossibleDuplicate } from "@/server/db/transaction-service";
import {
  getAccountsOverview,
  getCategoryBreakdown,
  getPaymentMethodBreakdown,
  getTotals,
} from "@/server/db/analytics";
import { rangeFor } from "@/lib/ranges";
import { outstandingOf, typeLabel, type AccountType, type TransactionType } from "@/lib/financial";
import type { CategoryTree } from "@/lib/types";

/**
 * The assistant's toolset.
 *
 * One tool per *financial meaning*, not one generic "add transaction" — the
 * model choosing `create_transfer` over `create_expense` is the classification
 * decision, made explicit and auditable, instead of hidden in a `type` field it
 * could fill in carelessly.
 *
 * Every write goes through the same transaction service the UI uses, so the
 * model cannot reach the database directly and cannot bypass validation.
 */

export type ToolContext = {
  userId: string;
  accounts: { id: string; name: string; type: AccountType }[];
  categories: CategoryTree[];
};

type Outcome = { result: unknown; isError: boolean };

const ok = (result: unknown): Outcome => ({ result, isError: false });
const err = (message: string): Outcome => ({
  result: { ok: false, error: message },
  isError: true,
});

/* --- shared field shapes -------------------------------------------------- */

const amount = z.number().positive().describe("Amount in rupees, already normalised (5k -> 5000).");
const dateField = z.string().describe("Date as yyyy-mm-dd. Default to today.");
const accountRef = (what: string) => z.string().describe(`Id of the ${what} from the catalogue.`);
const categoryRef = z.string().describe("Id of a top-level category from the catalogue.");
const range = z
  .string()
  .describe(
    'Period: "today", "yesterday", "this week", "this month", "last month", "this year", a month name, or "between 2026-08-01 and 2026-08-10".',
  );

export const TOOL_SCHEMAS = {
  create_expense: z.object({
    amount,
    source_account_id: accountRef("account the money came out of"),
    category_id: categoryRef,
    subcategory_id: z.string().optional().describe("Optional subcategory of the chosen category."),
    payment_method: z
      .enum(["UPI", "CASH", "DEBIT_CARD", "CREDIT_CARD", "BANK_TRANSFER", "OTHER"])
      .describe("How it was paid. UPI/GPay/PhonePe/Paytm all mean UPI."),
    date: dateField,
    merchant: z.string().optional().describe("Merchant name, e.g. Swiggy. Not the category."),
    description: z.string().optional().describe("Short description, e.g. 'Lunch'."),
  }),

  create_income: z.object({
    amount,
    destination_account_id: accountRef("account the money landed in"),
    category_id: z.string().optional().describe("Optional income category id."),
    date: dateField,
    description: z.string().optional().describe("e.g. 'Salary'."),
  }),

  create_transfer: z.object({
    amount,
    source_account_id: accountRef("account money left"),
    destination_account_id: accountRef("account money arrived in"),
    payment_method: z.enum(["UPI", "BANK_TRANSFER", "OTHER"]).optional(),
    date: dateField,
    description: z.string().optional(),
  }),

  create_cash_withdrawal: z.object({
    amount,
    source_account_id: accountRef("bank account the cash came from"),
    destination_account_id: accountRef("cash account it went into"),
    date: dateField,
  }),

  create_credit_card_payment: z.object({
    amount,
    source_account_id: accountRef("bank account paying the bill"),
    destination_account_id: accountRef("credit card being paid"),
    date: dateField,
  }),

  create_refund: z.object({
    amount,
    destination_account_id: accountRef("account the money came back into"),
    linked_transaction_id: z
      .string()
      .optional()
      .describe("Id of the original expense, when the user identifies it."),
    date: dateField,
    merchant: z.string().optional(),
    description: z.string().optional(),
  }),

  get_spending_summary: z.object({
    period: range,
    category_id: z.string().optional().describe("Restrict to one category."),
    payment_method: z.string().optional().describe("Restrict to one payment method, e.g. UPI."),
  }),

  get_account_balances: z.object({}),

  get_recent_transactions: z.object({
    limit: z.number().int().min(1).max(20).optional().describe("Default 10."),
  }),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;
export const TOOL_NAMES = Object.keys(TOOL_SCHEMAS) as ToolName[];

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  create_expense:
    "Record money actually spent — food, rent, shopping, a card purchase, cash spending. Use this only when the money left the user's world.",
  create_income:
    "Record money arriving from outside — salary, freelance payment, interest, cashback. Never use this for the user moving their own money.",
  create_transfer:
    "Move money between two accounts the user owns. This is NOT an expense. Use for bank-to-bank, savings-to-current.",
  create_cash_withdrawal:
    "Record an ATM or counter withdrawal: money leaves a bank and becomes cash the user still holds. This is NOT an expense.",
  create_credit_card_payment:
    "Record paying a credit-card bill from a bank account. This settles a liability and is NOT an expense — the purchases were already counted.",
  create_refund:
    "Record money returned by a merchant. Reduces net spending; it is not income.",
  get_spending_summary:
    "Total net spending (expenses minus refunds) for a period, optionally filtered by category or payment method.",
  get_account_balances:
    "Current balance of every account, cash in hand, credit-card outstanding, and net worth.",
  get_recent_transactions: "The most recent transactions, newest first.",
};

/* --- resolution helpers --------------------------------------------------- */

type Resolved<T> = { account: T; error?: undefined } | { account?: undefined; error: string };

function resolveAccount(
  ctx: ToolContext,
  id: string | undefined,
  label: string,
): Resolved<ToolContext["accounts"][number]> {
  if (!id) return { error: `Missing the ${label}.` };
  const found = ctx.accounts.find((a) => a.id === id);
  if (!found) {
    return {
      error: `Unknown ${label}. Valid accounts: ${ctx.accounts
        .map((a) => `${a.name} [${a.id}]`)
        .join(", ")}`,
    };
  }
  return { account: found };
}

function resolveCategory(
  ctx: ToolContext,
  id: string | undefined,
): { category: CategoryTree | null; error?: undefined } | { category?: undefined; error: string } {
  if (!id) return { category: null };
  const parent = ctx.categories.find((c) => c.id === id);
  if (parent) return { category: parent };
  return {
    error: `Unknown category. Valid categories: ${ctx.categories
      .map((c) => `${c.name} [${c.id}]`)
      .join(", ")}`,
  };
}

const money = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/* --- the executor --------------------------------------------------------- */

/**
 * Runs one tool call. Returns data, never throws, so the model can read an
 * error and correct itself rather than telling the user it failed.
 */
export async function runTool(
  ctx: ToolContext,
  name: ToolName,
  rawInput: unknown,
): Promise<Outcome> {
  const parsed = TOOL_SCHEMAS[name].safeParse(rawInput ?? {});
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const input = parsed.data as Record<string, never>;

  /** Shared path for every write: build, validate, persist, describe. */
  const write = async (
    type: TransactionType,
    fields: Parameters<typeof createTransaction>[1],
    describe: (id: string) => string,
  ): Promise<Outcome> => {
    try {
      const duplicate = await findPossibleDuplicate(ctx.userId, fields);
      const row = await createTransaction(ctx.userId, {
        ...fields,
        type,
        created_by: "assistant",
      });
      return ok({
        ok: true,
        transaction_id: row.id,
        type,
        type_label: typeLabel(type),
        summary: describe(row.id),
        duplicate_warning: duplicate
          ? "A near-identical transaction was recorded moments ago."
          : undefined,
      });
    } catch (error) {
      // The service throws TRPCError with a user-facing message.
      return err(error instanceof Error ? error.message : "Could not save that.");
    }
  };

  switch (name) {
    case "create_expense": {
      const src = resolveAccount(ctx, input.source_account_id, "source account");
      if (src.error) return err(src.error);
      const source = src.account!;
      const cat = resolveCategory(ctx, input.category_id);
      if (cat.error) return err(cat.error);
      const category = cat.category ?? null;

      return write(
        "EXPENSE",
        {
          type: "EXPENSE",
          amount: input.amount,
          source_account_id: source.id,
          category_id: category?.id ?? null,
          subcategory_id: input.subcategory_id ?? null,
          payment_method: input.payment_method ?? null,
          date: input.date,
          merchant: input.merchant ?? null,
          description: input.description ?? null,
        },
        () =>
          `${money(input.amount)} ${category?.name ?? "expense"} from ${source.name}` +
          (input.payment_method ? ` using ${String(input.payment_method).replace("_", " ").toLowerCase()}` : ""),
      );
    }

    case "create_income": {
      const dst = resolveAccount(ctx, input.destination_account_id, "destination account");
      if (dst.error) return err(dst.error);
      const dest = dst.account!;
      return write(
        "INCOME",
        {
          type: "INCOME",
          amount: input.amount,
          destination_account_id: dest.id,
          category_id: input.category_id ?? null,
          date: input.date,
          description: input.description ?? null,
        },
        () => `${money(input.amount)} income into ${dest.name}`,
      );
    }

    case "create_transfer": {
      const src = resolveAccount(ctx, input.source_account_id, "source account");
      if (src.error) return err(src.error);
      const source = src.account!;
      const dst = resolveAccount(ctx, input.destination_account_id, "destination account");
      if (dst.error) return err(dst.error);
      const dest = dst.account!;
      return write(
        "TRANSFER",
        {
          type: "TRANSFER",
          amount: input.amount,
          source_account_id: source.id,
          destination_account_id: dest.id,
          payment_method: input.payment_method ?? null,
          date: input.date,
          description: input.description ?? null,
        },
        () => `${money(input.amount)} transfer from ${source.name} to ${dest.name}`,
      );
    }

    case "create_cash_withdrawal": {
      const src = resolveAccount(ctx, input.source_account_id, "bank account");
      if (src.error) return err(src.error);
      const source = src.account!;
      const dst = resolveAccount(ctx, input.destination_account_id, "cash account");
      if (dst.error) return err(dst.error);
      const dest = dst.account!;
      return write(
        "CASH_WITHDRAWAL",
        {
          type: "CASH_WITHDRAWAL",
          amount: input.amount,
          source_account_id: source.id,
          destination_account_id: dest.id,
          payment_method: "ATM",
          date: input.date,
        },
        () => `${money(input.amount)} cash withdrawal from ${source.name}`,
      );
    }

    case "create_credit_card_payment": {
      const src = resolveAccount(ctx, input.source_account_id, "paying account");
      if (src.error) return err(src.error);
      const source = src.account!;
      const dst = resolveAccount(ctx, input.destination_account_id, "credit card");
      if (dst.error) return err(dst.error);
      const dest = dst.account!;
      return write(
        "CREDIT_CARD_PAYMENT",
        {
          type: "CREDIT_CARD_PAYMENT",
          amount: input.amount,
          source_account_id: source.id,
          destination_account_id: dest.id,
          payment_method: "BANK_TRANSFER",
          date: input.date,
        },
        () => `${money(input.amount)} credit-card payment from ${source.name} to ${dest.name}`,
      );
    }

    case "create_refund": {
      const dst = resolveAccount(ctx, input.destination_account_id, "account");
      if (dst.error) return err(dst.error);
      const dest = dst.account!;
      return write(
        "REFUND",
        {
          type: "REFUND",
          amount: input.amount,
          destination_account_id: dest.id,
          linked_transaction_id: input.linked_transaction_id ?? null,
          date: input.date,
          merchant: input.merchant ?? null,
          description: input.description ?? null,
        },
        () => `${money(input.amount)} refund into ${dest.name}`,
      );
    }

    /* --- reads ----------------------------------------------------------- */

    case "get_spending_summary": {
      const period = rangeFor(input.period ?? "this month");
      const totals = await getTotals(ctx.userId, period);

      if (input.category_id) {
        const rows = await getCategoryBreakdown(ctx.userId, period);
        const row = rows.find((r) => r.id === input.category_id);
        return ok({
          period,
          category: row?.name ?? "that category",
          net_spend: row?.total ?? 0,
          note: "Net of refunds. Transfers, withdrawals and card payments are excluded.",
        });
      }

      if (input.payment_method) {
        const rows = await getPaymentMethodBreakdown(ctx.userId, period);
        const row = rows.find(
          (r) => r.method.toLowerCase() === String(input.payment_method).toLowerCase(),
        );
        return ok({ period, payment_method: input.payment_method, net_spend: row?.total ?? 0 });
      }

      return ok({
        period,
        net_spend: totals.spend,
        income: totals.income,
        net_cash_flow: totals.netCashFlow,
        by_category: await getCategoryBreakdown(ctx.userId, period),
        note: "Spending excludes transfers, cash withdrawals and credit-card payments.",
      });
    }

    case "get_account_balances": {
      const overview = await getAccountsOverview(ctx.userId);
      return ok({
        accounts: overview.accounts.map((a) => ({
          name: a.name,
          type: a.type,
          balance: a.current_balance,
          outstanding: outstandingOf(a.type, a.current_balance) || undefined,
        })),
        available_cash: overview.availableCash,
        credit_card_outstanding: overview.creditOutstanding,
        net_worth: overview.netWorth,
      });
    }

    case "get_recent_transactions": {
      const rows = await db
        .select({
          id: transactions.id,
          type: transactions.type,
          amount: transactions.amount,
          date: transactions.date,
          merchant: transactions.merchant,
          description: transactions.description,
        })
        .from(transactions)
        .where(eq(transactions.user_id, ctx.userId))
        .orderBy(transactions.date)
        .limit(input.limit ?? 10);
      return ok({ transactions: rows });
    }

    default:
      return err(`Unknown tool: ${name}`);
  }
}

/** Account list for the system prompt, with balances so answers can be direct. */
export async function loadToolContext(userId: string, categories: CategoryTree[]) {
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      current_balance: accounts.current_balance,
      institution_name: accounts.institution_name,
      account_number_last4: accounts.account_number_last4,
    })
    .from(accounts)
    .where(and(eq(accounts.user_id, userId), eq(accounts.is_active, true)));

  return {
    userId,
    categories,
    accounts: rows.map((a) => ({ ...a, type: a.type as AccountType })),
  };
}
