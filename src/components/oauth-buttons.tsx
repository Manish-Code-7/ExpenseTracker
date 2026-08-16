"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

type Provider = "google";

/**
 * OAuth runs in the browser: Better Auth sends the user to the provider and
 * back through /api/auth/callback/:provider, which a server action can't drive.
 *
 * Apple was dropped in the Neon migration — Supabase brokered it, and Better
 * Auth needs an Apple developer account and key of your own to re-enable.
 */
export function OAuthButtons({ next }: { next?: string }) {
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(provider: Provider) {
    setPending(provider);
    setError(null);

    const callbackURL =
      next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

    const { error } = await authClient.signIn.social({ provider, callbackURL });

    if (error) {
      setError(error.message ?? "Could not start sign-in.");
      setPending(null);
    }
    // On success the browser is already navigating away.
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => signIn("google")}
        disabled={pending !== null}
        className="btn btn-secondary w-full"
      >
        <GoogleMark />
        {pending === "google" ? "Opening…" : "Continue with Google"}
      </button>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3 pt-1">
        <span className="h-px flex-1 bg-line" />
        <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
          or with email
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

