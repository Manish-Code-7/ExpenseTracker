import { and, asc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { categories } from "@/server/db/schema";
import { buildCategoryTree, type Category, type CategoryTree } from "@/lib/types";

/**
 * Category reads for server components.
 *
 * Each takes the signed-in user's id explicitly: nothing scopes rows for us,
 * so an unscoped query here would read every user's categories.
 * Accounts and transactions have their own modules — see server/db/analytics.
 */

/** Visible categories as a two-level tree, for pickers. */
export async function getCategoryTree(userId: string): Promise<CategoryTree[]> {
  const rows = await db
    .select()
    .from(categories)
    .where(and(eq(categories.user_id, userId), eq(categories.is_hidden, false)))
    .orderBy(asc(categories.name));
  return buildCategoryTree(rows as Category[]);
}

/** Every category, hidden ones included — for the management screen. */
export async function getAllCategories(userId: string): Promise<CategoryTree[]> {
  const rows = await db
    .select()
    .from(categories)
    .where(eq(categories.user_id, userId))
    .orderBy(asc(categories.name));
  return buildCategoryTree(rows as Category[]);
}
