import { initTRPC, TRPCError } from "@trpc/server";
import { headers } from "next/headers";
import { ZodError } from "zod";
import { auth } from "@/server/auth";
import { db, dbForUser } from "@/server/db";

/**
 * The request context. The Better Auth session is resolved once here and every
 * procedure reads it from `ctx.session`.
 *
 * Note this is now the *only* place ownership is established. On Supabase, RLS
 * re-checked `auth.uid()` inside Postgres on every statement; Neon has no
 * request identity, so each query below must filter by `ctx.userId` itself.
 */
export async function createContext() {
  const headerList = await headers();
  const session = await auth.api.getSession({ headers: headerList });

  // When DATABASE_AUTHENTICATED_URL is configured, queries run through the
  // `authenticated` role carrying this user's JWT, so the policies in
  // neon/03_rls.sql apply on top of the explicit scoping below. Without it,
  // dbForUser returns the owner connection and scoping is the only guard.
  const scopedDb = session
    ? dbForUser(async () => {
        const result = await auth.api.getToken({ headers: headerList });
        return result?.token ?? null;
      })
    : db;

  return { db: scopedDb, session, headers: headerList };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    // Surface the first Zod message as the error text, so a form can render
    // `error.message` directly rather than digging through a flattened tree.
    const zod = error.cause instanceof ZodError ? error.cause.issues[0] : null;
    return {
      ...shape,
      message: zod?.message ?? shape.message,
      data: {
        ...shape.data,
        fieldErrors: zod ? { [String(zod.path[0])]: zod.message } : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

/** Everything behind the app shell. Narrows `ctx.session` to non-null. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Your session expired. Reload the page and sign in again.",
    });
  }
  return next({
    ctx: { ...ctx, session: ctx.session, userId: ctx.session.user.id },
  });
});
