import { sql } from "drizzle-orm";
import { db } from "@/server/db";

/**
 * Runs the detection routine for one user.
 *
 * The heavy lifting stays in Postgres (neon/02_functions.sql) — it is a set
 * operation over the whole expense history and is far cheaper there than in
 * application code. On Supabase this was `detect_my_recurring_patterns()`,
 * which read `auth.uid()`; Neon has no request identity, so the caller passes
 * the id and the tRPC procedure is what guarantees it is the signed-in user's.
 */
export async function detectRecurringForUser(userId: string) {
  await db.execute(sql`select public.detect_recurring_patterns(${userId})`);
}
