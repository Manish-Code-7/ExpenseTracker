import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { accounts, transactions } from "@/server/db/schema";
import { requireUser } from "@/server/session";
import { PageHeader } from "@/components/page-header";
import { AccountForm } from "@/components/account-form";
import { AdjustBalance, DeleteAccountButton } from "@/components/mutations";
import { moneyPrecise } from "@/lib/format";
import { isLiability, outstandingOf, type AccountType } from "@/lib/financial";

export const dynamic = "force-dynamic";

export default async function EditAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.user_id, user.id)))
    .limit(1);

  if (!row) notFound();

  const [used] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, user.id),
        sql`(${transactions.source_account_id} = ${id} or ${transactions.destination_account_id} = ${id})`,
      ),
    );

  const usedBy = used?.n ?? 0;
  const type = row.type as AccountType;
  const owed = outstandingOf(type, row.current_balance);

  return (
    <>
      <PageHeader
        title="Edit account"
        subtitle={`${row.name} · ${isLiability(type) ? `${moneyPrecise(owed)} owed` : moneyPrecise(row.current_balance)}`}
      />

      <AccountForm
        account={{
          id: row.id,
          name: row.name,
          type,
          institution_name: row.institution_name,
          account_number_last4: row.account_number_last4,
          credit_limit: row.credit_limit,
          billing_cycle_day: row.billing_cycle_day,
          color_tag: row.color_tag,
          opening_balance: row.opening_balance,
          current_balance: row.current_balance,
        }}
      />

      <section className="card mt-8 p-4">
        <h2 className="font-display text-base font-semibold text-ink">Set balance</h2>
        <p className="mt-1 text-sm text-ink-soft">
          If the real balance has drifted from what&rsquo;s here, state the correct
          figure. The difference is recorded as an adjustment, so nothing changes
          silently.
        </p>
        <AdjustBalance
          accountId={row.id}
          current={row.current_balance}
          isLiability={isLiability(type)}
        />
      </section>

      <section className="card mt-6 p-4">
        <h2 className="font-display text-base font-semibold text-ink">Remove this account</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {usedBy > 0
            ? `${usedBy} transaction${usedBy === 1 ? "" : "s"} reference this account, so removing it archives it instead. History keeps its name and colour.`
            : "Nothing references this account yet, so it will be deleted outright."}
        </p>
        <div className="mt-3">
          <DeleteAccountButton id={row.id} className="btn btn-secondary text-danger">
            {usedBy > 0 ? "Archive account" : "Delete account"}
          </DeleteAccountButton>
        </div>
      </section>
    </>
  );
}
