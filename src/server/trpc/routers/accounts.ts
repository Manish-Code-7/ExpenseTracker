import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { protectedProcedure, router } from "@/server/trpc/init";
import { accounts, transactions } from "@/server/db/schema";
import { adjustAccountBalance, recomputeBalances } from "@/server/db/transaction-service";
import { getAccountsOverview } from "@/server/db/analytics";
import {
  accountInput,
  adjustBalanceInput,
  idInput,
  setAccountActiveInput,
  updateAccountInput,
} from "@/lib/schemas";

function refresh() {
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
}

export const accountsRouter = router({
  list: protectedProcedure.query(({ ctx }) => getAccountsOverview(ctx.userId)),

  byId: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, input.id), eq(accounts.user_id, ctx.userId)))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found." });
    return row;
  }),

  create: protectedProcedure.input(accountInput).mutation(async ({ ctx, input }) => {
    // The opening balance is the starting point; current tracks it from there.
    const [row] = await ctx.db
      .insert(accounts)
      .values({
        ...input,
        institution_name: input.institution_name ?? null,
        account_number_last4: input.account_number_last4 ?? null,
        credit_limit: input.credit_limit ?? null,
        billing_cycle_day: input.billing_cycle_day ?? null,
        current_balance: input.opening_balance,
        user_id: ctx.userId,
      })
      .returning({ id: accounts.id });

    refresh();
    return { id: row.id };
  }),

  update: protectedProcedure.input(updateAccountInput).mutation(async ({ ctx, input }) => {
    // Deliberately does not touch current_balance — only the ledger moves that.
    const rows = await ctx.db
      .update(accounts)
      .set({
        name: input.values.name,
        type: input.values.type,
        institution_name: input.values.institution_name ?? null,
        account_number_last4: input.values.account_number_last4 ?? null,
        credit_limit: input.values.credit_limit ?? null,
        billing_cycle_day: input.values.billing_cycle_day ?? null,
        color_tag: input.values.color_tag,
        updated_at: new Date().toISOString(),
      })
      .where(and(eq(accounts.id, input.id), eq(accounts.user_id, ctx.userId)))
      .returning({ id: accounts.id });

    if (rows.length === 0) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Account not found." });
    }
    refresh();
    return { id: input.id };
  }),

  setActive: protectedProcedure
    .input(setAccountActiveInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(accounts)
        .set({ is_active: input.isActive })
        .where(and(eq(accounts.id, input.id), eq(accounts.user_id, ctx.userId)));
      refresh();
      return { id: input.id };
    }),

  /** Archives when history exists, deletes only when nothing references it. */
  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const [used] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(transactions)
      .where(
        and(
          eq(transactions.user_id, ctx.userId),
          sql`(${transactions.source_account_id} = ${input.id} or ${transactions.destination_account_id} = ${input.id})`,
        ),
      );

    const owned = and(eq(accounts.id, input.id), eq(accounts.user_id, ctx.userId));

    if ((used?.n ?? 0) > 0) {
      await ctx.db.update(accounts).set({ is_active: false }).where(owned);
      refresh();
      return { archived: true as const };
    }

    await ctx.db.delete(accounts).where(owned);
    refresh();
    return { archived: false as const };
  }),

  /** Records the difference as an ADJUSTMENT so the change stays traceable. */
  adjustBalance: protectedProcedure
    .input(adjustBalanceInput)
    .mutation(async ({ ctx, input }) => {
      const row = await adjustAccountBalance(
        ctx.userId,
        input.accountId,
        input.targetBalance,
        input.date,
        input.notes ?? undefined,
      );
      refresh();
      return { adjusted: row !== null };
    }),

  /** Repair tool: rebuild balances from the ledger. */
  recompute: protectedProcedure.mutation(async ({ ctx }) => {
    const balances = await recomputeBalances(ctx.userId);
    refresh();
    return balances;
  }),
});
