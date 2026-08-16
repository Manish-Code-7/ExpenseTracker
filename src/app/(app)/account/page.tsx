import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { profiles, account as accountTable } from "@/server/db/schema";
import { requireUser } from "@/server/session";
import { PageHeader } from "@/components/page-header";
import { ProfileForm } from "@/components/profile-form";
import { SignOutButton } from "@/components/sign-out-button";
import { initials, type Profile } from "@/lib/profile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your details — Ledger" };

export default async function AccountPage() {
  const user = await requireUser();

  const [[row], linked] = await Promise.all([
    db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1),
    db
      .select({ provider_id: accountTable.providerId })
      .from(accountTable)
      .where(eq(accountTable.userId, user.id)),
  ]);

  const profile = (row ?? null) as Profile | null;

  // Better Auth records a "credential" account for password signups and the
  // provider name for OAuth; only the former has a password to change.
  const canChangePassword = linked.some((a) => a.provider_id === "credential");

  return (
    <>
      <PageHeader
        title="Your details"
        subtitle="Only you can see these. They're stored against your account and nothing else."
      />

      <section className="card mb-5 flex items-center gap-4 p-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink font-display text-lg font-semibold text-paper">
          {initials(profile, user?.email)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">
            {profile?.full_name || "No name set"}
          </p>
          <p className="truncate text-sm text-ink-muted">{user?.email}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Signed in with {linked.map((a) => a.provider_id === "credential" ? "email" : a.provider_id).join(" and ") || "email"}
          </p>
        </div>
      </section>

      <ProfileForm profile={profile} />

      <section className="card mt-8 p-4">
        <h2 className="font-display text-base font-semibold text-ink">
          Account
        </h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {canChangePassword ? (
            <Link href="/forgot-password" className="btn btn-secondary">
              Change password
            </Link>
          ) : null}
          <SignOutButton />
        </div>
        {canChangePassword ? (
          <p className="mt-3 text-xs text-ink-muted">
            We&rsquo;ll email you a link to set a new one.
          </p>
        ) : (
          <p className="mt-3 text-xs text-ink-muted">
            Your password is managed by your sign-in provider, not by Ledger.
          </p>
        )}
      </section>
    </>
  );
}
