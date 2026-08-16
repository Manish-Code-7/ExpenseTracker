"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { SimpleAuthForm } from "@/components/simple-auth-form";
import { authClient } from "@/lib/auth-client";

function ResetPasswordForm() {
  const router = useRouter();
  // Better Auth puts the one-time token in the query string of the link it
  // emails; an expired or missing token surfaces when the reset is submitted.
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");

  if (!token) {
    return (
      <AuthShell
        title="That link isn't valid"
        subtitle="Reset links expire after an hour. Ask for a fresh one."
      >
        <Link href="/forgot-password" className="btn btn-primary w-full">
          Send a new link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Pick something you don't use anywhere else."
    >
      <SimpleAuthForm
        submitLabel="Save new password"
        pendingLabel="Saving…"
        onSubmit={async () => {
          const { error } = await authClient.resetPassword({
            newPassword: password,
            token,
          });
          if (error) {
            return { error: error.message ?? "That link has expired." };
          }
          router.push("/login");
          router.refresh();
          return { message: "Password updated. Signing you in…" };
        }}
        fields={
          <div>
            <label className="label" htmlFor="password">
              New password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
        }
      />
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
