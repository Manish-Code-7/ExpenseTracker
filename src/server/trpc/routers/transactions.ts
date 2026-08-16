import { TRPCError } from "@trpc/server";
import { aliasedTable, and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { protectedProcedure, router } from "@/server/trpc/init";
import { accounts, categories, transactions } from "@/server/db/schema";
import {
  createTransaction,
  deleteTransaction,
  findPossibleDuplicate,
  updateTransaction,
} from "@/server/db/transaction-service";
import { getRefundedTotals } from "@/server/db/analytics";
import {
  idInput,
  transactionFilters,
  transactionInput,
  updateTransactionInput,
} from "@/lib/schemas";

const PAGE_SIZE = 25;

function refresh() {
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/accounts");
}

const srcAccount = aliasedTable(accounts, "src_account");
const dstAccount = aliasedTable(accounts, "dst_account");
const parentCat = aliasedTable(categories, "txn_parent_cat");
const subCat = aliasedTable(categories, "txn_sub_cat");

/** Everything a transaction row needs to render, in one round trip. */
const withRefs = {
  txn: transactions,
  source: sql<{ id: string; name: string; color_tag: string; type: string } | null>`
    case when ${srcAccount.id} is null then null else json_build_object(
      'id', ${srcAccount.id}, 'name', ${srcAccount.name},
      'color_tag', ${srcAccount.color_tag}, 'type', ${srcAccount.type}) end`,
  destination: sql<{ id: string; name: string; color_tag: string; type: string } | null>`
    case when ${dstAccount.id} is null then null else json_build_object(
      'id', ${dstAccount.id}, 'name', ${dstAccount.name},
      'color_tag', ${dstAccount.color_tag}, 'type', ${dstAccount.type}) end`,
  category: sql<{ id: string; name: string } | null>`
    case when ${parentCat.id} is null then null else json_build_object(
      'id', ${parentCat.id}, 'name', ${parentCat.name}) end`,
  subcategory: sql<{ id: string; name: string } | null>`
    case when ${subCat.id} is null then null else json_build_object(
      'id', ${subCat.id}, 'name', ${subCat.name}) end`,
};

export const transactionsRouter = router({
  list: protectedProcedure
    .input(transactionFilters)
    .query(async ({ ctx, input }) => {
      const search = input.search?.trim();
      const where = and(
        eq(transactions.user_id, ctx.userId),
        input.from ? gte(transactions.date, input.from) : undefined,
        input.to ? lte(transactions.date, input.to) : undefined,
        input.type ? eq(transactions.type, input.type) : undefined,
        input.categoryId
          ? or(
              eq(transactions.category_id, input.categoryId),
              eq(transactions.subcategory_id, input.categoryId),
            )
          : undefined,
        input.paymentMethod
          ? eq(transactions.payment_method, input.paymentMethod)
          : undefined,
        input.accountId
          ? or(
              eq(transactions.source_account_id, input.accountId),
              eq(transactions.destination_account_id, input.accountId),
            )
          : undefined,
        input.minAmount != null ? gte(transactions.amount, input.minAmount) : undefined,
        input.maxAmount != null ? lte(transactions.amount, input.maxAmount) : undefined,
        // §53: search across the fields a person would actually remember.
        search
          ? or(
              ilike(transactions.description, `%${search}%`),
              ilike(transactions.merchant, `%${search}%`),
              ilike(transactions.notes, `%${search}%`),
            )
          : undefined,
      );

      const [rows, counted] = await Promise.all([
        ctx.db
          .select(withRefs)
          .from(transactions)
          .leftJoin(srcAccount, eq(srcAccount.id, transactions.source_account_id))
          .leftJoin(dstAccount, eq(dstAccount.id, transactions.destination_account_id))
          .leftJoin(parentCat, eq(parentCat.id, transactions.category_id))
          .leftJoin(subCat, eq(subCat.id, transactions.subcategory_id))
          .where(where)
          .orderBy(desc(transactions.date), desc(transactions.created_at))
          .limit(PAGE_SIZE)
          .offset((input.page - 1) * PAGE_SIZE),
        ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(transactions)
          .where(where),
      ]);

      // Show expenses net of anything already refunded.
      const refunded = await getRefundedTotals(
        ctx.userId,
        rows.map((r) => r.txn.id),
      );

      return {
        items: rows.map((r) => ({
          ...r.txn,
          source: r.source,
          destination: r.destination,
          category: r.category,
          subcategory: r.subcategory,
          refunded: refunded.get(r.txn.id) ?? 0,
        })),
        total: counted[0]?.n ?? 0,
        pageSize: PAGE_SIZE,
        page: input.page,
      };
    }),

  byId: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, input.id), eq(transactions.user_id, ctx.userId)))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "That transaction is gone." });
    return row;
  }),

  /** Warns about a near-identical recent row without blocking the write. */
  checkDuplicate: protectedProcedure
    .input(transactionInput)
    .mutation(async ({ ctx, input }) => {
      const match = await findPossibleDuplicate(ctx.userId, input);
      return match ? { duplicate: true as const, id: match.id } : { duplicate: false as const };
    }),

  create: protectedProcedure.input(transactionInput).mutation(async ({ ctx, input }) => {
    const row = await createTransaction(ctx.userId, input);
    refresh();
    return { id: row.id };
  }),

  update: protectedProcedure
    .input(updateTransactionInput)
    .mutation(async ({ ctx, input }) => {
      await updateTransaction(ctx.userId, input.id, input.values);
      refresh();
      return { id: input.id };
    }),

  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await deleteTransaction(ctx.userId, input.id);
    refresh();
    return { id: input.id };
  }),
});
