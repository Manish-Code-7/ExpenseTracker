import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { accounts, categories, profiles } from "@/server/db/schema";

/**
 * Preset categories and a single Cash method for a brand-new account.
 *
 * On Supabase this was `seed_defaults_for_user()` fired by a trigger on
 * `auth.users`. Better Auth has no such trigger, so it runs from the
 * `databaseHooks.user.create.after` hook — and `ensureSeed` below is the same
 * safety net the app used to call via RPC on first load.
 *
 * Every step is guarded, so running it twice is harmless.
 */
const PRESETS: Record<string, string[]> = {
  Food: ["Groceries", "Dining Out", "Delivery"],
  Bills: ["Phone", "Internet", "Electricity", "Water", "Rent"],
  Transport: ["Fuel", "Public Transport", "Cab"],
  Shopping: [],
  Subscriptions: ["Streaming", "Software", "Gym"],
  Health: [],
  Entertainment: [],
  Other: [],
};

export async function seedDefaultsForUser(
  userId: string,
  fullName?: string | null,
  avatarUrl?: string | null,
) {
  await db
    .insert(profiles)
    .values({
      id: userId,
      full_name: fullName?.trim() || null,
      avatar_url: avatarUrl?.trim() || null,
    })
    .onConflictDoNothing();

  // Cash is the only seeded account — everyone has some, and without at least
  // one account a new user can't record anything at all. Banks and cards are
  // theirs to add.
  const existingAccount = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.user_id, userId))
    .limit(1);

  if (existingAccount.length === 0) {
    await db.insert(accounts).values({
      user_id: userId,
      name: "Cash",
      type: "CASH",
      color_tag: "#22c55e",
      opening_balance: 0,
      current_balance: 0,
    });
  }

  const existingCategory = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.user_id, userId))
    .limit(1);

  if (existingCategory.length > 0) return;

  const parents = await db
    .insert(categories)
    .values(
      Object.keys(PRESETS).map((name) => ({
        user_id: userId,
        name,
        is_preset: true,
      })),
    )
    .returning({ id: categories.id, name: categories.name });

  const children = parents.flatMap((parent) =>
    (PRESETS[parent.name] ?? []).map((name) => ({
      user_id: userId,
      name,
      parent_category_id: parent.id,
      is_preset: true,
    })),
  );

  if (children.length > 0) {
    await db.insert(categories).values(children);
  }
}

/** Safety net for accounts created before the hook existed. */
export async function ensureSeed(userId: string) {
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.user_id, userId))
    .limit(1);

  if (existing.length === 0) await seedDefaultsForUser(userId);
}
