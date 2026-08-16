import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";
import { seedDefaultsForUser } from "@/server/db/seed";
import { sendResetPasswordEmail, sendVerificationEmail } from "@/server/email";

/**
 * Better Auth replaces Supabase Auth.
 *
 * Identity lives in your own Neon database (`user`, `session`, `account`,
 * `verification`), so there is no external auth service and no `auth.uid()`.
 * Ownership is enforced in the tRPC layer instead — see server/trpc/init.ts.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // Sign-in works immediately, as it did on Supabase; the confirmation mail
    // below is a nudge rather than a gate.
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url }) => {
      await sendResetPasswordEmail(user.email, url);
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail(user.email, url);
    },
  },

  socialProviders:
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : undefined,

  databaseHooks: {
    user: {
      create: {
        // Replaces the `on_auth_user_created` trigger: every new account gets
        // its preset categories, a Cash method, and a profile row.
        after: async (user) => {
          await seedDefaultsForUser(user.id, user.name, user.image ?? null);
        },
      },
    },
  },

  plugins: [
    /**
     * Issues JWTs (EdDSA by default) and publishes the public keys at
     * /api/auth/jwks. Neon verifies tokens against that URL, so
     * `auth.user_id()` inside an RLS policy resolves to `sub` below —
     * the same identity the tRPC layer scopes by.
     */
    jwt({
      jwt: {
        issuer: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
        audience: "neon",
        expirationTime: "15m",
        // pg_session_jwt reads the user id from `sub`.
        definePayload: ({ user }) => ({ sub: user.id, email: user.email }),
      },
    }),
    // Lets server actions and route handlers set the session cookie.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
