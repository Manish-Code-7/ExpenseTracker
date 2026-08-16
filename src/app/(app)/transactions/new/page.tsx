import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/page-header";
import { TransactionForm } from "@/components/transaction-form";
import { getCategoryTree } from "@/lib/queries";
import { getAccountsOverview } from "@/server/db/analytics";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function NewTransactionPage() {
  const user = await requireUser();
  const [overview, categories] = await Promise.all([
    getAccountsOverview(user.id),
    getCategoryTree(user.id),
  ]);

  const accounts = overview.accounts.filter((a) => a.is_active);

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Add transaction" />
        <EmptyState
          title="Add an account first"
          body="Every transaction moves money between accounts, so you need at least one — a bank, a card, or cash."
          action={
            <Link href="/accounts/new" className="btn btn-primary">
              Add an account
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Add transaction" />
      <TransactionForm accounts={accounts} categories={categories} />
    </>
  );
}
