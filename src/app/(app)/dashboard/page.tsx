import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { profiles } from "@/server/db/schema";
import { requireUser } from "@/server/session";
import { PageHeader, EmptyState } from "@/components/page-header";
import { ColorDot } from "@/components/method-chip";
import {
  getAccountBreakdown,
  getAccountsOverview,
  getCategoryBreakdown,
  getTotals,
} from "@/server/db/analytics";
import { monthRange, rangeFor } from "@/lib/ranges";
import { money, moneyPrecise } from "@/lib/format";
import { monthLabel } from "@/lib/dates";
import { displayName, type Profile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const month = monthRange();

  const [profileRow, totals, overview, categories, byAccount, today, week] =
    await Promise.all([
      db.select({ full_name: profiles.full_name }).from(profiles).where(eq(profiles.id, user.id)).limit(1),
      getTotals(user.id, month),
      getAccountsOverview(user.id),
      getCategoryBreakdown(user.id, month),
      getAccountBreakdown(user.id, month),
      getTotals(user.id, rangeFor("today")),
      getTotals(user.id, rangeFor("this week")),
    ]);

  const greeting = `Hi ${displayName((profileRow[0] ?? null) as Pick<Profile, "full_name"> | null, user.email)}`;
  const hasActivity = totals.spend > 0 || totals.income > 0;

  return (
    <>
      <PageHeader title={greeting} subtitle={monthLabel(month.from)} />

      {/* Money in, money out, and what you're actually worth. */}
      <section className="card mb-4 grid grid-cols-2 gap-4 p-4">
        <Figure label="Spent this month" value={moneyPrecise(totals.spend)} />
        <Figure label="Income" value={moneyPrecise(totals.income)} />
        <Figure
          label="Net cash flow"
          value={moneyPrecise(totals.netCashFlow)}
          tone={totals.netCashFlow < 0 ? "danger" : "positive"}
        />
        <Figure label="Net worth" value={moneyPrecise(overview.netWorth)} />
      </section>

      <section className="card mb-4 grid grid-cols-3 gap-4 p-4">
        <Figure label="Today" value={money(today.spend)} small />
        <Figure label="This week" value={money(week.spend)} small />
        <Figure label="Cash" value={money(overview.availableCash)} small />
      </section>

      {overview.creditOutstanding > 0 ? (
        <section className="card mb-4 p-4">
          <p className="label">Credit card outstanding</p>
          <p className="tnum font-display text-2xl font-semibold text-ink">
            {moneyPrecise(overview.creditOutstanding)}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Already counted as spending when each purchase was made — paying the
            bill won&rsquo;t be counted again.
          </p>
        </section>
      ) : null}

      {!hasActivity ? (
        <EmptyState
          title="Nothing recorded yet"
          body="Add a transaction, or just tell the assistant what you spent."
          action={
            <div className="flex gap-2">
              <Link href="/transactions/new" className="btn btn-primary">Add transaction</Link>
              <Link href="/chat" className="btn btn-secondary">Ask the assistant</Link>
            </div>
          }
        />
      ) : null}

      {overview.accounts.length > 0 ? (
        <Section title="Accounts" href="/accounts">
          <ul className="card divide-y divide-line overflow-hidden">
            {overview.accounts.filter((a) => a.is_active).map((a) => (
              <li key={a.id} className="flex items-center gap-3 p-3.5">
                <ColorDot color={a.color_tag} size={10} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{a.name}</span>
                <span className="tnum shrink-0 text-sm font-medium text-ink">
                  {moneyPrecise(a.current_balance)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {categories.length > 0 ? (
        <Section title="Where it went">
          <ul className="card divide-y divide-line overflow-hidden">
            {categories.slice(0, 8).map((c) => (
              <li key={c.id} className="flex items-center gap-3 p-3.5">
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.name}</span>
                <span className="tnum shrink-0 text-sm font-medium text-ink">{money(c.total)}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {byAccount.length > 0 ? (
        <Section title="Spending by account">
          <ul className="card divide-y divide-line overflow-hidden">
            {byAccount.map((a) => (
              <li key={a.id} className="flex items-center gap-3 p-3.5">
                <ColorDot color={a.color} size={10} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{a.name}</span>
                <span className="tnum shrink-0 text-sm font-medium text-ink">{money(a.total)}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

function Figure({
  label, value, tone, small,
}: { label: string; value: string; tone?: "danger" | "positive"; small?: boolean }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p
        className={`tnum font-display font-semibold ${small ? "text-lg" : "text-2xl"} ${
          tone === "danger" ? "text-danger" : tone === "positive" ? "text-positive" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Section({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="label">{title}</h2>
        {href ? <Link href={href} className="text-xs font-medium text-ink-soft underline">See all</Link> : null}
      </div>
      {children}
    </section>
  );
}
