import Link from "next/link";
import { aliasedTable, desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { accounts, categories, recurringPatterns } from "@/server/db/schema";
import { requireUser } from "@/server/session";
import { PageHeader, EmptyState } from "@/components/page-header";
import { RecurringButton, RescanButton } from "@/components/mutations";
import { ColorDot } from "@/components/method-chip";
import { money, formatDate, relativeDays } from "@/lib/format";
import { daysBetween, todayISO } from "@/lib/dates";

export const dynamic = "force-dynamic";

const FREQUENCY_LABEL: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

const cat = aliasedTable(categories, "rp_cat");

export default async function RecurringPage() {
  const user = await requireUser();

  const patterns = await db
    .select({
      p: recurringPatterns,
      categoryName: cat.name,
      accountName: accounts.name,
      accountColor: accounts.color_tag,
    })
    .from(recurringPatterns)
    .leftJoin(cat, eq(cat.id, recurringPatterns.category_id))
    .leftJoin(accounts, eq(accounts.id, recurringPatterns.account_id))
    .where(eq(recurringPatterns.user_id, user.id))
    .orderBy(desc(recurringPatterns.confidence_score));

  const today = todayISO();
  const suggested = patterns.filter((r) => !r.p.is_confirmed && !r.p.is_dismissed);
  const confirmed = patterns.filter((r) => r.p.is_confirmed);
  const dismissed = patterns.filter((r) => r.p.is_dismissed);

  return (
    <>
      <PageHeader
        title="Recurring"
        subtitle="Repeat spends spotted in your history. Confirm the real ones and they show up before they hit."
        action={<RescanButton className="btn btn-secondary shrink-0" />}
      />

      {patterns.length === 0 ? (
        <EmptyState
          title="Nothing detected yet"
          body="Detection needs at least three similar expenses on the same category and account, spaced evenly apart. Keep recording and run a scan."
          action={
            <Link href="/transactions/new" className="btn btn-primary">
              Add a transaction
            </Link>
          }
        />
      ) : null}

      {([["Suggested", suggested], ["Confirmed", confirmed], ["Dismissed", dismissed]] as const).map(
        ([title, rows]) =>
          rows.length > 0 ? (
            <section key={title} className="mb-7">
              <h2 className="label">
                {title} ({rows.length})
              </h2>
              <ul className="space-y-3">
                {rows.map((r) => {
                  const days = r.p.next_due_date ? daysBetween(today, r.p.next_due_date) : null;
                  const state = r.p.is_confirmed ? "confirmed" : r.p.is_dismissed ? "dismissed" : "suggested";
                  return (
                    <li key={r.p.id} className={`card p-4 ${state === "dismissed" ? "opacity-60" : ""}`}>
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-display text-base font-semibold text-ink">
                            {r.categoryName ?? "Uncategorised"}
                            {r.p.merchant_or_note_pattern ? (
                              <span className="font-sans text-sm font-normal text-ink-soft">
                                {" · "}
                                {r.p.merchant_or_note_pattern}
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
                            <ColorDot color={r.accountColor ?? "#94a3b8"} size={8} />
                            <span className="truncate">{r.accountName ?? "Removed account"}</span>
                            <span aria-hidden>·</span>
                            <span>{FREQUENCY_LABEL[r.p.frequency] ?? r.p.frequency}</span>
                            <span aria-hidden>·</span>
                            <span className="tnum">every ~{r.p.avg_interval_days} days</span>
                          </p>
                          <p className="mt-2 text-xs text-ink-muted">
                            Seen {r.p.occurrence_count} times · {Math.round(r.p.confidence_score * 100)}% confidence
                            {days !== null ? ` · next ${relativeDays(days)}` : ""}
                            {" · last "}
                            {formatDate(r.p.last_detected_date)}
                          </p>
                        </div>
                        <span className="tnum shrink-0 font-display text-base font-semibold text-ink">
                          ~{money(r.p.average_amount)}
                        </span>
                      </div>

                      <div className="mt-3 flex gap-2">
                        {state === "suggested" ? (
                          <>
                            <RecurringButton id={r.p.id} action="confirm" className="btn btn-primary h-10 min-h-10 flex-1 text-sm">
                              Yes, it&rsquo;s recurring
                            </RecurringButton>
                            <RecurringButton id={r.p.id} action="dismiss" className="btn btn-secondary h-10 min-h-10 text-sm">
                              Not recurring
                            </RecurringButton>
                          </>
                        ) : (
                          <RecurringButton id={r.p.id} action="reset" className="btn btn-ghost h-9 min-h-9 px-2 text-sm">
                            {state === "confirmed" ? "Unconfirm" : "Undo dismiss"}
                          </RecurringButton>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null,
      )}
    </>
  );
}
