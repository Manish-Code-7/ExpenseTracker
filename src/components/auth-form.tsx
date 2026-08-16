"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OAuthButtons } from "@/components/oauth-buttons";
import { authClient } from "@/lib/auth-client";

export function AuthForm({
  mode,
  next,
  initialError,
}: {
  mode: "login" | "signup";
  next?: string;
  initialError?: string;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setPending(true);

    const callbackURL = next && next.startsWith("/") ? next : "/dashboard";

    const { error: authError } =
      mode === "login"
        ? await authClient.signIn.email({ email, password, callbackURL })
        : await authClient.signUp.email({
            email,
            password,
            name: fullName.trim() || email.split("@")[0],
            callbackURL,
          });

    setPending(false);

    if (authError) {
      setError(authError.message ?? "That didn't work. Check your details.");
      return;
    }

    router.push(callbackURL);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <OAuthButtons next={next} />

      <form onSubmit={submit} className="space-y-4">
        {mode === "signup" ? (
          <div>
            <label className="label" htmlFor="full_name">
              Name
            </label>
            <input
              id="full_name"
              autoComplete="name"
              maxLength={80}
              className="field"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="What should we call you?"
            />
          </div>
        ) : null}

        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label className="label" htmlFor="password">
              Password
            </label>
            {mode === "login" ? (
              <Link
                href="/forgot-password"
                className="mb-1.5 text-xs font-medium text-ink-soft underline"
              >
                Forgot password?
              </Link>
            ) : null}
          </div>
          <input
            id="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "signup" ? 8 : undefined}
            className="field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        {message ? (
          <p role="status" className="text-sm text-positive">
            {message}
          </p>
        ) : null}

        <button type="submit" className="btn btn-primary w-full" disabled={pending}>
          {pending
            ? mode === "login"
              ? "Signing in…"
              : "Creating account…"
            : mode === "login"
              ? "Sign in"
              : "Create account"}
        </button>

        <p className="pt-1 text-center text-sm text-ink-soft">
          {mode === "login" ? (
            <>
              No account yet?{" "}
              <Link href="/signup" className="font-medium text-ink underline">
                Create one
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-ink underline">
                Sign in
              </Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
