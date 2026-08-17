import { z } from "zod";
import { revalidatePath } from "next/cache";
import { protectedProcedure, router } from "@/server/trpc/init";
import {
  backfillRules,
  deleteRule,
  listRules,
  upsertRule,
} from "@/server/db/merchant-rules";

const uuid = z.uuid("Pick a valid option.");

export const rulesRouter = router({
  list: protectedProcedure.query(({ ctx }) => listRules(ctx.userId)),

  upsert: protectedProcedure
    .input(
      z.object({
        pattern: z
          .string()
          .trim()
          .min(2, "Give the rule at least two characters to match on.")
          .max(60, "Keep the pattern short — it matches on a fragment."),
        categoryId: uuid,
        subcategoryId: uuid.nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const r = await upsertRule(ctx.userId, input);
      revalidatePath("/rules");
      return r;
    }),

  delete: protectedProcedure
    .input(z.object({ id: uuid }))
    .mutation(async ({ ctx, input }) => {
      const r = await deleteRule(ctx.userId, input.id);
      revalidatePath("/rules");
      return r;
    }),

  /** Seed rules from transactions recorded before rules existed. */
  backfill: protectedProcedure.mutation(async ({ ctx }) => {
    const r = await backfillRules(ctx.userId);
    revalidatePath("/rules");
    return r;
  }),
});
