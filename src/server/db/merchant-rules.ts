import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/server/db";
import { categories, merchantRules, transactions } from "@/server/db/schema";
import { normalise, significantWords } from "@/lib/matching";

/**
 * Learning where a merchant belongs.
 *
 * The app watches what the user files things under and remembers it, so the
 * second Swiggy order categorises itself. Cheaper and more accurate than
 * asking a model, because it reflects *their* choices rather than a general
 * guess — someone may well file Uber under Travel where someone else files it
 * under Transport, and both are right for them.
 *
 * Rules are visible and editable, so a wrong inference can be corrected once
 * rather than fought with repeatedly.
 */

/**
 * The stable part of a merchant name, used as the rule's pattern.
 *
 * Bank descriptions carry per-transaction noise ("SWIGGY*BLR/8842217"), so a
 * rule keyed on the whole string would never match twice. Taking the leading
 * significant words keeps what identifies the merchant and drops the rest.
 */
export function patternFor(merchant: string): string | null {
  // Noise words are excluded deliberately: a rule keyed on "upi" or "pos"
  // would match every payment and file the whole ledger under one category.
  const words = significantWords(merchant);
  if (words.length === 0) return null;
  return words.slice(0, 2).join(" ");
}

export type Rule = {
  id: string;
  pattern: string;
  category_id: string;
  subcategory_id: string | null;
  source: "LEARNED" | "MANUAL";
  hit_count: number;
};

export async function listRules(userId: string) {
  const parent = categories;
  return db
    .select({
      id: merchantRules.id,
      pattern: merchantRules.pattern,
      category_id: merchantRules.category_id,
      subcategory_id: merchantRules.subcategory_id,
      source: merchantRules.source,
      hit_count: merchantRules.hit_count,
      category_name: parent.name,
    })
    .from(merchantRules)
    .leftJoin(parent, eq(parent.id, merchantRules.category_id))
    .where(eq(merchantRules.user_id, userId))
    .orderBy(desc(merchantRules.hit_count), asc(merchantRules.pattern));
}

/**
 * Pick the rule that applies to a merchant string.
 *
 * Longer patterns win: "swiggy instamart" is more specific than "swiggy" and
 * should take precedence when both match. Ties break on how often a rule has
 * actually been used.
 */
export function matchRule<T extends { pattern: string; hit_count: number }>(
  rules: T[],
  merchant: string,
): T | null {
  const text = normalise(merchant);
  if (!text) return null;

  const hits = rules.filter((r) => text.includes(r.pattern) || r.pattern.includes(text));
  if (hits.length === 0) return null;

  return hits.sort(
    (a, b) => b.pattern.length - a.pattern.length || b.hit_count - a.hit_count,
  )[0];
}

/** All of a user's rules, for classifying a batch in one pass. */
export async function loadRules(userId: string): Promise<Rule[]> {
  const rows = await db
    .select({
      id: merchantRules.id,
      pattern: merchantRules.pattern,
      category_id: merchantRules.category_id,
      subcategory_id: merchantRules.subcategory_id,
      source: merchantRules.source,
      hit_count: merchantRules.hit_count,
    })
    .from(merchantRules)
    .where(eq(merchantRules.user_id, userId));
  return rows as Rule[];
}

/**
 * Remember that this merchant belongs in this category.
 *
 * Called whenever a transaction is saved with both a merchant and a category.
 * A rule the user wrote by hand is never overwritten by inference — an
 * explicit correction has to outrank a pattern the app noticed.
 */
export async function learnFromTransaction(
  tx: Tx | typeof db,
  userId: string,
  merchant: string | null | undefined,
  categoryId: string | null | undefined,
  subcategoryId?: string | null,
) {
  if (!merchant || !categoryId) return;
  const pattern = patternFor(merchant);
  if (!pattern) return;

  await tx
    .insert(merchantRules)
    .values({
      user_id: userId,
      pattern,
      category_id: categoryId,
      subcategory_id: subcategoryId ?? null,
      source: "LEARNED",
      hit_count: 1,
    })
    .onConflictDoUpdate({
      target: [merchantRules.user_id, merchantRules.pattern],
      set: {
        category_id: sql`case when ${merchantRules.source} = 'MANUAL'
                          then ${merchantRules.category_id} else excluded.category_id end`,
        subcategory_id: sql`case when ${merchantRules.source} = 'MANUAL'
                             then ${merchantRules.subcategory_id} else excluded.subcategory_id end`,
        hit_count: sql`${merchantRules.hit_count} + 1`,
        updated_at: new Date().toISOString(),
      },
    });
}

/** Create or replace a rule the user wrote deliberately. */
export async function upsertRule(
  userId: string,
  input: { pattern: string; categoryId: string; subcategoryId?: string | null },
) {
  const pattern = normalise(input.pattern).trim();
  if (!pattern) throw new Error("Give the rule something to match on.");

  const [row] = await db
    .insert(merchantRules)
    .values({
      user_id: userId,
      pattern,
      category_id: input.categoryId,
      subcategory_id: input.subcategoryId ?? null,
      source: "MANUAL",
    })
    .onConflictDoUpdate({
      target: [merchantRules.user_id, merchantRules.pattern],
      set: {
        category_id: input.categoryId,
        subcategory_id: input.subcategoryId ?? null,
        source: "MANUAL",
        updated_at: new Date().toISOString(),
      },
    })
    .returning({ id: merchantRules.id });

  return { id: row.id };
}

export async function deleteRule(userId: string, id: string) {
  await db
    .delete(merchantRules)
    .where(and(eq(merchantRules.id, id), eq(merchantRules.user_id, userId)));
  return { id };
}

/**
 * Seed rules from transactions recorded before rules existed.
 *
 * One-off backfill so the feature starts useful rather than empty. Only pairs
 * seen more than once are taken — a single occurrence is not yet a habit.
 */
export async function backfillRules(userId: string) {
  const rows = await db
    .select({
      merchant: transactions.merchant,
      category_id: transactions.category_id,
      subcategory_id: transactions.subcategory_id,
      n: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, userId),
        sql`${transactions.merchant} is not null`,
        sql`${transactions.category_id} is not null`,
      ),
    )
    .groupBy(transactions.merchant, transactions.category_id, transactions.subcategory_id)
    .orderBy(sql`count(*) desc`);

  let created = 0;
  const seen = new Set<string>();

  for (const row of rows) {
    const pattern = patternFor(row.merchant ?? "");
    // Most-used first, so the first pattern wins and later contradictions are
    // ignored rather than flip-flopping.
    if (!pattern || seen.has(pattern)) continue;
    seen.add(pattern);

    await db
      .insert(merchantRules)
      .values({
        user_id: userId,
        pattern,
        category_id: row.category_id!,
        subcategory_id: row.subcategory_id,
        source: "LEARNED",
        hit_count: row.n,
      })
      .onConflictDoNothing({ target: [merchantRules.user_id, merchantRules.pattern] });
    created++;
  }

  return { created };
}
