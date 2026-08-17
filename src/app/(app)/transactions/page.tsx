import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { TransactionList } from "@/components/transaction-list";
import { getCategoryTree } from "@/lib/queries";
import { getAccountsOverview } from "@/server/db/analytics";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const user = await requireUser();
  const [overview, categories] = await Promise.all([
    getAccountsOverview(user.id),
    getCategoryTree(user.id),
  ]);

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="Everything that moved — spending, income, and money you just shifted around."
        action={
          <div className="flex shrink-0 gap-2">
            <Link href="/transactions/import" className="btn btn-secondary">Import</Link>
            <Link href="/transactions/new" className="btn btn-primary">Add</Link>
          </div>
        }
      />
      <TransactionList
        accounts={overview.accounts.map((a) => ({ id: a.id, name: a.name }))}
        categories={categories}
      />
    </>
  );
}
