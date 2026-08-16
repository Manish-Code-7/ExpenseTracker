import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { profiles } from "@/server/db/schema";
import { requireUser } from "@/server/session";
import { ensureSeed } from "@/server/db/seed";
import { BottomNav, TopNav } from "@/components/nav";
import { TRPCProvider } from "@/lib/trpc";
import { initials, type Profile } from "@/lib/profile";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  // Safety net for accounts created before the signup hook existed.
  await ensureSeed(user.id);

  const [row] = await db
    .select({ id: profiles.id, full_name: profiles.full_name })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  const profile = (row ?? null) as Pick<Profile, "id" | "full_name"> | null;

  return (
    <TRPCProvider>
      <div className="min-h-dvh">
        <header className="sticky top-0 z-20 border-b border-line bg-[color-mix(in_oklab,var(--backdrop)_72%,transparent)] backdrop-blur-xl">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
            <Link
              href="/dashboard"
              className="font-display text-lg font-semibold tracking-tight"
            >
              Ledger
            </Link>

            <div className="ml-auto flex items-center gap-1">
              <TopNav />
              <Link
                href="/categories"
                className="rounded-lg px-2.5 py-2 text-sm font-medium text-ink-soft hover:text-ink md:hidden"
              >
                Categories
              </Link>
              <Link
                href="/account"
                aria-label="Your details"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong bg-card text-xs font-semibold text-ink backdrop-blur-md"
              >
                {initials(profile, user.email)}
              </Link>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl px-4 pt-5 pb-28 md:pb-10">
          {children}
        </main>

        <BottomNav />
      </div>
    </TRPCProvider>
  );
}
