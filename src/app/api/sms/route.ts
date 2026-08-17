import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { accounts, profiles } from "@/server/db/schema";
import { stageSms } from "@/server/db/import-service";
import { isBankSender } from "@/lib/banks";

export const dynamic = "force-dynamic";

/**
 * Where an SMS forwarder on the user's phone posts bank alerts.
 *
 * A browser cannot read SMS and a phone cannot hold a session, so this
 * authenticates on a per-user token instead — scoped to ingestion only, and
 * rotatable without disturbing the login. Nothing here writes to the ledger:
 * messages land in the same review queue as statements and email.
 *
 * Expects: { token, from, text, receivedAt? }
 */
export async function POST(request: Request) {
  let body: { token?: string; from?: string; text?: string; receivedAt?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Expected JSON." }, { status: 400 });
  }

  const token = body.token?.trim();
  const text = body.text?.trim();
  const sender = body.from?.trim() ?? "";

  if (!token) return Response.json({ ok: false, error: "Missing token." }, { status: 401 });
  if (!text) return Response.json({ ok: false, error: "Missing text." }, { status: 400 });

  const [owner] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.sms_token, token))
    .limit(1);

  // Deliberately the same answer as a valid token with unusable content would
  // give no attacker anything: an unknown token simply is not authorised.
  if (!owner) return Response.json({ ok: false, error: "Not authorised." }, { status: 401 });

  // Forwarders relay everything; only bank senders are worth parsing, and this
  // keeps personal messages out of the pipeline entirely.
  if (sender && !isBankSender(sender)) {
    return Response.json({ ok: true, staged: false, reason: "not a bank sender" });
  }

  // Alerts that don't name an account fall back to the user's cash-free
  // default: the single active bank account, when there is only one.
  const banks = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.user_id, owner.id),
        eq(accounts.is_active, true),
        eq(accounts.type, "BANK"),
      ),
    );
  const fallback = banks.length === 1 ? banks[0].id : null;

  try {
    const result = await stageSms(owner.id, text, sender, fallback, body.receivedAt);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("[sms] staging failed:", error);
    return Response.json({ ok: false, error: "Could not process that message." }, { status: 500 });
  }
}
