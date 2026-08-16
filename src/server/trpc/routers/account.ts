import { revalidatePath } from "next/cache";
import { protectedProcedure, router } from "@/server/trpc/init";
import { profiles } from "@/server/db/schema";
import { profileInput } from "@/lib/schemas";

export const accountRouter = router({
  updateProfile: protectedProcedure
    .input(profileInput)
    .mutation(async ({ ctx, input }) => {
      const values = {
        full_name: input.full_name ?? null,
        date_of_birth: input.date_of_birth ?? null,
        gender: input.gender ?? null,
        updated_at: new Date().toISOString(),
      };

      await ctx.db
        .insert(profiles)
        .values({ id: ctx.userId, ...values })
        .onConflictDoUpdate({ target: profiles.id, set: values });

      revalidatePath("/account");
      // The header avatar renders from the profile, so refresh the whole shell.
      revalidatePath("/", "layout");
      return { savedAt: Date.now() };
    }),
});
