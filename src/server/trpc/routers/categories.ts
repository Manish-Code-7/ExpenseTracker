import { TRPCError } from "@trpc/server";
import { and, eq, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { protectedProcedure, router } from "@/server/trpc/init";
import { categories, transactions } from "@/server/db/schema";
import {
  categoryInput,
  idInput,
  renameCategoryInput,
  setCategoryHiddenInput,
} from "@/lib/schemas";
import type { Context } from "@/server/trpc/init";

function refresh() {
  revalidatePath("/categories");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
}

/** Hiding a parent hides everything under it, so pickers stay consistent. */
async function setHidden(
  db: Context["db"],
  userId: string,
  id: string,
  hidden: boolean,
) {
  await db
    .update(categories)
    .set({ is_hidden: hidden })
    .where(
      and(
        eq(categories.user_id, userId),
        or(eq(categories.id, id), eq(categories.parent_category_id, id)),
      ),
    );
}

export const categoriesRouter = router({
  create: protectedProcedure
    .input(categoryInput)
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.db.insert(categories).values({
          user_id: ctx.userId,
          name: input.name,
          parent_category_id: input.parent_category_id ?? null,
          is_preset: false,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: /duplicate key|unique/i.test(message)
            ? "You already have that one."
            : message,
        });
      }

      refresh();
      return { ok: true };
    }),

  rename: protectedProcedure
    .input(renameCategoryInput)
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.db
          .update(categories)
          .set({ name: input.name })
          .where(
            and(eq(categories.id, input.id), eq(categories.user_id, ctx.userId)),
          );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: /duplicate key|unique/i.test(message)
            ? "You already have that one."
            : message,
        });
      }

      refresh();
      return { ok: true };
    }),

  setHidden: protectedProcedure
    .input(setCategoryHiddenInput)
    .mutation(async ({ ctx, input }) => {
      await setHidden(ctx.db, ctx.userId, input.id, input.hidden);
      refresh();
      return { ok: true };
    }),

  /**
   * Presets are never deleted, only hidden. A custom category that expenses
   * already point at is hidden too — deleting it would orphan history.
   */
  delete: protectedProcedure
    .input(idInput)
    .mutation(async ({ ctx, input }) => {
      const [category] = await ctx.db
        .select({ id: categories.id, is_preset: categories.is_preset })
        .from(categories)
        .where(and(eq(categories.id, input.id), eq(categories.user_id, ctx.userId)))
        .limit(1);

      if (!category) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That category is gone." });
      }

      const [used] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(transactions)
        .where(
          and(
            eq(transactions.user_id, ctx.userId),
            or(
              eq(transactions.category_id, input.id),
              eq(transactions.subcategory_id, input.id),
            ),
          ),
        );

      if (category.is_preset || (used?.n ?? 0) > 0) {
        await setHidden(ctx.db, ctx.userId, input.id, true);
        refresh();
        return { hidden: true as const };
      }

      await ctx.db
        .delete(categories)
        .where(and(eq(categories.id, input.id), eq(categories.user_id, ctx.userId)));
      refresh();
      return { hidden: false as const };
    }),
});
