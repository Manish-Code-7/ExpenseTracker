"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { SimpleAuthForm } from "@/components/simple-auth-form";
import { authClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a link to choose a new one."
    >
      <SimpleAuthForm
        submitLabel="Email me a link"
        pendingLabel="Sending…"
        onSubmit={async () => {
          const { error } = await authClient.requestPasswordReset({
            email,
            redirectTo: "/reset-password",
          });
          if (error) return { error: error.message ?? "Could not send the email." };
          // Deliberately the same answer either way, so this can't be used to
          // find out which addresses have accounts.
          return {
            message: "If that address has an account, the link is on its way.",
          };
        }}
        fields={
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
        }
        footer={
          <p className="pt-1 text-center text-sm text-ink-soft">
            <Link href="/login" className="font-medium text-ink underline">
              Back to sign in
            </Link>
          </p>
        }
      />
    </AuthShell>
  );
}
