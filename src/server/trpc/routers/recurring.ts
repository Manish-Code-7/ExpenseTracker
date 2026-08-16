import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { protectedProcedure, router } from "@/server/trpc/init";
import { recurringPatterns } from "@/server/db/schema";
import { detectRecurringForUser } from "@/server/db/recurring";
import { idInput } from "@/lib/schemas";

function refresh() {
  revalidatePath("/recurring");
  revalidatePath("/dashboard");
}

const setFlags = (confirmed: boolean, dismissed: boolean) =>
  protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db
      .update(recurringPatterns)
      .set({ is_confirmed: confirmed, is_dismissed: dismissed })
      .where(
        and(
          eq(recurringPatterns.id, input.id),
          eq(recurringPatterns.user_id, ctx.userId),
        ),
      );
    refresh();
    return { id: input.id };
  });

export const recurringRouter = router({
  confirm: setFlags(true, false),
  dismiss: setFlags(false, true),
  /** Back to "suggested" — undoes a confirm or a dismiss. */
  reset: setFlags(false, false),

  /** Runs the same detection the nightly job runs, for this user only. */
  rescan: protectedProcedure.mutation(async ({ ctx }) => {
    await detectRecurringForUser(ctx.userId);
    refresh();
    return { ok: true };
  }),
});
