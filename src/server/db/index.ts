import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "@/server/db/schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.local.example to .env.local and paste " +
      "your Neon connection string, then restart the dev server.",
  );
}

// The WebSocket driver, not neon-http, because http has no transaction support
// and a multi-account write must be all-or-nothing (financial invariant 9).
if (typeof WebSocket === "undefined") neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: url });

/**
 * The owner connection. Used by Better Auth (it reads `user` before anyone is
 * authenticated), the signup seeding hook, and the tRPC layer, which scopes
 * every query by `ctx.userId` itself.
 */
export const db = drizzle(pool, { schema });

export type Db = typeof db;
/** Either the pool or an open transaction — what the service layer accepts. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * An RLS-enforcing connection for a signed-in user. Neon verifies the JWT
 * against the JWKS Better Auth publishes at /api/auth/jwks, and pg_session_jwt
 * exposes its `sub` claim as `auth.user_id()` inside policies.
 */
export function dbForUser(getToken: () => Promise<string | null>) {
  const authedUrl = process.env.DATABASE_AUTHENTICATED_URL;
  if (!authedUrl) return db;

  // authToken is accepted by the driver but missing from PoolConfig's types.
  const authedPool = new Pool({ connectionString: authedUrl });
  (authedPool as unknown as { authToken: () => Promise<string> }).authToken =
    async () => (await getToken()) ?? "";

  return drizzle(authedPool, { schema });
}
