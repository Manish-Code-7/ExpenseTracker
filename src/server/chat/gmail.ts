import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/server/db";
import { account as accountTable } from "@/server/db/schema";

/**
 * Reading bank alerts out of Gmail.
 *
 * Better Auth already holds the Google refresh token from sign-in, so this
 * asks it for a valid access token rather than managing the OAuth dance again.
 * Nothing here interprets money — it fetches message text and hands it to the
 * parser, which feeds the same ingestion pipeline as statement uploads.
 */

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

/**
 * Only mail that looks like a bank alert, and only recent mail.
 *
 * Deliberately narrow: the scope grants access to the whole mailbox, so the
 * query is the thing keeping this to what the feature actually needs.
 */
export function buildQuery(sinceDays: number): string {
  const senders = [
    "alerts@hdfcbank.net", "alerts@hdfcbank.com",
    "no-reply@sbi.co.in", "donotreply@sbi.co.in",
    "credit_cards@icicibank.com", "no.reply@icicibank.com",
    "alerts@axisbank.com", "cc.statements@axisbank.com",
    "alerts@kotak.com", "noreply@kotak.com",
  ];
  const from = senders.map((s) => `from:${s}`).join(" OR ");
  const subjects = [
    "subject:(transaction alert)", "subject:(debited)", "subject:(credited)",
    "subject:(spent)", "subject:(payment)",
  ].join(" OR ");
  return `newer_than:${sinceDays}d (${from} OR ${subjects})`;
}

export type GmailMessage = { id: string; text: string; date: string };

async function tokenFor(userId: string, headers: Headers): Promise<string> {
  const [linked] = await db
    .select({ scope: accountTable.scope })
    .from(accountTable)
    .where(and(eq(accountTable.userId, userId), eq(accountTable.providerId, "google")))
    .limit(1);

  if (!linked) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Connect your Google account first — sign in with Google, then try again.",
    });
  }
  if (!linked.scope?.includes("gmail.readonly")) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Gmail access hasn't been granted. Use \"Connect Gmail\" to allow reading bank alerts.",
    });
  }

  // Better Auth refreshes the token when it has expired.
  const { auth } = await import("@/server/auth");
  const result = await auth.api.getAccessToken({
    body: { providerId: "google", userId },
    headers,
  });

  const token = (result as { accessToken?: string })?.accessToken;
  if (!token) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Google access expired. Sign in with Google again to reconnect.",
    });
  }
  return token;
}

/** Decode Gmail's URL-safe base64 body parts. */
function decode(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

/** Walk the MIME tree and pull out readable text. */
function extractText(payload: unknown): string {
  const p = payload as {
    mimeType?: string;
    body?: { data?: string };
    parts?: unknown[];
  };
  if (!p) return "";

  if (p.body?.data && (p.mimeType === "text/plain" || p.mimeType === "text/html")) {
    const raw = decode(p.body.data);
    return p.mimeType === "text/html" ? stripHtml(raw) : raw;
  }
  if (Array.isArray(p.parts)) {
    // Prefer plain text; fall back to whatever the tree yields.
    const plain = p.parts.map(extractText).find((t) => t.trim());
    return plain ?? "";
  }
  return "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fetch recent bank-alert messages. */
export async function fetchBankMail(
  userId: string,
  headers: Headers,
  sinceDays = 30,
  max = 50,
): Promise<GmailMessage[]> {
  const token = await tokenFor(userId, headers);
  const auth = { Authorization: `Bearer ${token}` };

  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", buildQuery(sinceDays));
  listUrl.searchParams.set("maxResults", String(max));

  const listRes = await fetch(listUrl, { headers: auth });
  if (!listRes.ok) {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: `Gmail refused the request (${listRes.status}). Try reconnecting Gmail.`,
    });
  }

  const list = (await listRes.json()) as { messages?: { id: string }[] };
  const ids = (list.messages ?? []).map((m) => m.id);
  if (ids.length === 0) return [];

  const messages: GmailMessage[] = [];
  for (const id of ids) {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      { headers: auth },
    );
    if (!res.ok) continue;

    const msg = (await res.json()) as {
      payload?: unknown;
      internalDate?: string;
      snippet?: string;
    };
    const text = extractText(msg.payload) || msg.snippet || "";
    if (!text.trim()) continue;

    const when = msg.internalDate ? new Date(Number(msg.internalDate)) : new Date();
    messages.push({ id, text, date: when.toISOString().slice(0, 10) });
  }

  return messages;
}
