import { z } from "zod";
import { revalidatePath } from "next/cache";
import { protectedProcedure, router } from "@/server/trpc/init";
import {
  confirmItems,
  ignoreItems,
  listPending,
  stageStatement,
} from "@/server/db/import-service";

const uuid = z.uuid("Pick a valid option.");

export const importRouter = router({
  pending: protectedProcedure.query(({ ctx }) => listPending(ctx.userId)),

  /** Parse and stage a statement. Nothing reaches the ledger yet. */
  stageStatement: protectedProcedure
    .input(
      z.object({
        accountId: uuid,
        // Sent as text: statements are small, and this keeps the parser
        // testable without multipart handling.
        csv: z.string().min(1, "That file looks empty.").max(4_000_000, "That file is too large."),
      }),
    )
    .mutation(({ ctx, input }) => stageStatement(ctx.userId, input.accountId, input.csv)),

  confirm: protectedProcedure
    .input(
      z.object({
        items: z
          .array(z.object({ id: uuid, categoryId: uuid.nullish() }))
          .min(1, "Nothing selected."),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await confirmItems(ctx.userId, input.items);
      revalidatePath("/transactions");
      revalidatePath("/dashboard");
      revalidatePath("/accounts");
      return result;
    }),

  ignore: protectedProcedure
    .input(z.object({ ids: z.array(uuid).min(1, "Nothing selected.") }))
    .mutation(async ({ ctx, input }) => {
      const result = await ignoreItems(ctx.userId, input.ids);
      revalidatePath("/transactions");
      return result;
    }),
});
