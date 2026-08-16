import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/page-header";
import { ColorDot } from "@/components/method-chip";
import { getAccountsOverview } from "@/server/db/analytics";
import { requireUser } from "@/server/session";
import { moneyPrecise } from "@/lib/format";

export const dynamic = "force-dynamic";

const ACCOUNT_LABEL: Record<string, string> = {
  BANK: "Bank",
  CREDIT_CARD: "Credit Card",
  CASH: "Cash",
  OTHER_ASSET: "Asset",
  OTHER_LIABILITY: "Liability",
};

export default async function AccountsPage() {
  const user = await requireUser();
  const { accounts, assets, liabilities, netWorth } = await getAccountsOverview(user.id);

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle={accounts.length > 0 ? `Net worth ${moneyPrecise(netWorth)}` : undefined}
        action={
          <Link href="/accounts/new" className="btn btn-primary shrink-0">
            Add
          </Link>
        }
      />

      {accounts.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          body="Add your bank accounts, cards and cash so the app can track balances and tell spending apart from money you just moved."
          action={
            <Link href="/accounts/new" className="btn btn-primary">
              Add an account
            </Link>
          }
        />
      ) : (
        <>
          <section className="card mb-4 grid grid-cols-2 gap-4 p-4">
            <div>
              <p className="label">Assets</p>
              <p className="tnum font-display text-xl font-semibold text-ink">
                {moneyPrecise(assets)}
              </p>
            </div>
            <div>
              <p className="label">Liabilities</p>
              <p className="tnum font-display text-xl font-semibold text-ink">
                {moneyPrecise(liabilities)}
              </p>
            </div>
          </section>

          <ul className="card divide-y divide-line overflow-hidden">
            {accounts.map((a) => (
              <li key={a.id} className={`flex items-center gap-3 p-4 ${a.is_active ? "" : "opacity-60"}`}>
                <ColorDot color={a.color_tag} size={12} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">
                    {a.name}
                    {a.is_active ? "" : " (archived)"}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {ACCOUNT_LABEL[a.type] ?? a.type}
                    {a.account_number_last4 ? ` ····${a.account_number_last4}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tnum font-display text-base font-semibold text-ink">
                    {moneyPrecise(a.current_balance)}
                  </p>
                  {a.isLiability && a.outstanding > 0 ? (
                    <p className="tnum text-xs text-ink-muted">
                      {moneyPrecise(a.outstanding)} owed
                    </p>
                  ) : null}
                </div>
                <Link
                  href={`/accounts/${a.id}`}
                  className="btn btn-ghost h-8 min-h-8 shrink-0 px-2 text-xs"
                >
                  Edit
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
