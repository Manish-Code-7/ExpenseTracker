import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/offline",
  "/forgot-password",
  // Reachable signed-out so an expired reset link can explain itself instead
  // of bouncing to a confusing login screen.
  "/reset-password",
];

/**
 * Runs before every matched request and bounces signed-out visitors to /login.
 * (Next 16 renamed this file convention from `middleware` to `proxy`.)
 *
 * This is an optimistic cookie check, not a session validation — Better Auth
 * advises against hitting the database from middleware. Every page and every
 * tRPC procedure re-checks the real session server-side, so a forged cookie
 * gets past this redirect and no further.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const hasSession = Boolean(getSessionCookie(request));

  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (hasSession && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Every path except static assets, the PWA files, image requests, and the
     * auth endpoints themselves.
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons/|api/auth|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
