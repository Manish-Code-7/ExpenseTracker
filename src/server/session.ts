import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";

/** The signed-in user, or null. */
export async function getUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

/**
 * The signed-in user, or a redirect to /login.
 *
 * Server components call this to get the id every query now needs — RLS used
 * to scope rows implicitly, so forgetting it on Supabase was harmless. Here it
 * would read every user's rows, which is why the query helpers take it as a
 * required argument rather than an optional one.
 */
export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
