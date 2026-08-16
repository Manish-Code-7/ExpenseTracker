"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser-side auth. Talks to /api/auth/[...all], which Better Auth serves.
 * Password reset lives on `authClient.forgetPassword` / `authClient.resetPassword`
 * and only works once an email sender is configured in server/auth.ts.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
