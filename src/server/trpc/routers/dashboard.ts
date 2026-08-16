import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/init";
import {
  getAccountBreakdown,
  getAccountsOverview,
  getCashFlowSeries,
  getCategoryBreakdown,
  getPaymentMethodBreakdown,
  getTotals,
} from "@/server/db/analytics";
import { monthRange, rangeFor } from "@/lib/ranges";

const rangeInput = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

export const dashboardRouter = router({
  summary: protectedProcedure.input(rangeInput).query(async ({ ctx, input }) => {
    const range =
      input.from && input.to ? { from: input.from, to: input.to } : monthRange();

    const [totals, overview, today, week] = await Promise.all([
      getTotals(ctx.userId, range),
      getAccountsOverview(ctx.userId),
      getTotals(ctx.userId, rangeFor("today")),
      getTotals(ctx.userId, rangeFor("this week")),
    ]);

    return {
      range,
      totalIncome: totals.income,
      totalExpenses: totals.spend,
      netCashFlow: totals.netCashFlow,
      netWorth: overview.netWorth,
      availableCash: overview.availableCash,
      creditOutstanding: overview.creditOutstanding,
      assets: overview.assets,
      liabilities: overview.liabilities,
      spentToday: today.spend,
      spentThisWeek: week.spend,
      accounts: overview.accounts,
    };
  }),

  categories: protectedProcedure.input(rangeInput).query(({ ctx, input }) =>
    getCategoryBreakdown(
      ctx.userId,
      input.from && input.to ? { from: input.from, to: input.to } : monthRange(),
    ),
  ),

  paymentMethods: protectedProcedure.input(rangeInput).query(({ ctx, input }) =>
    getPaymentMethodBreakdown(
      ctx.userId,
      input.from && input.to ? { from: input.from, to: input.to } : monthRange(),
    ),
  ),

  accounts: protectedProcedure.input(rangeInput).query(({ ctx, input }) =>
    getAccountBreakdown(
      ctx.userId,
      input.from && input.to ? { from: input.from, to: input.to } : monthRange(),
    ),
  ),

  cashFlow: protectedProcedure
    .input(z.object({ months: z.number().int().min(1).max(24).default(6) }))
    .query(({ ctx, input }) => getCashFlowSeries(ctx.userId, input.months)),
});
