import { Resend } from "resend";

/**
 * Outbound email.
 *
 * Supabase used to send confirmation and password-reset mail for us; Better
 * Auth has no mailer, so this is it. Without RESEND_API_KEY the app still runs
 * and the message is logged to the server console instead — which keeps local
 * development working without an account, and makes a missing key obvious
 * rather than silent.
 *
 * Swapping Resend for SMTP means changing only `deliver` below.
 */
const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM ?? "Ledger <onboarding@resend.dev>";

export const isEmailConfigured = Boolean(apiKey);

async function deliver(to: string, subject: string, html: string, text: string) {
  if (!apiKey) {
    console.warn(
      `\n[email] RESEND_API_KEY not set — not sending.\n  to: ${to}\n  subject: ${subject}\n  ${text}\n`,
    );
    return;
  }

  const { error } = await new Resend(apiKey).emails.send({
    from,
    to,
    subject,
    html,
    text,
  });

  // Better Auth swallows a rejected promise here, so surface it loudly.
  if (error) {
    console.error("[email] send failed:", error);
    throw new Error(error.message);
  }
}

function layout(heading: string, body: string, action: { href: string; label: string }) {
  return `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111">
  <h1 style="font-size:20px;margin:0 0 12px">${heading}</h1>
  <p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:#444">${body}</p>
  <a href="${action.href}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-size:15px;font-weight:600">${action.label}</a>
  <p style="font-size:13px;line-height:1.6;color:#777;margin:24px 0 0">
    If the button doesn't work, paste this into your browser:<br>
    <span style="word-break:break-all">${action.href}</span>
  </p>
  <p style="font-size:13px;color:#777;margin:16px 0 0">If you didn't ask for this, you can ignore this email.</p>
</div>`;
}

export function sendResetPasswordEmail(to: string, url: string) {
  return deliver(
    to,
    "Reset your Ledger password",
    layout(
      "Reset your password",
      "Click below to choose a new password. This link expires in an hour.",
      { href: url, label: "Choose a new password" },
    ),
    `Reset your Ledger password: ${url}`,
  );
}

export function sendVerificationEmail(to: string, url: string) {
  return deliver(
    to,
    "Confirm your email for Ledger",
    layout(
      "Confirm your email",
      "Click below to confirm this address and finish setting up your account.",
      { href: url, label: "Confirm email" },
    ),
    `Confirm your email for Ledger: ${url}`,
  );
}
