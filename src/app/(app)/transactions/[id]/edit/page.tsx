import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { transactions } from "@/server/db/schema";
import { requireUser } from "@/server/session";
import { PageHeader } from "@/components/page-header";
import { TransactionForm } from "@/components/transaction-form";
import { DeleteTransactionButton } from "@/components/mutations";
import { getCategoryTree } from "@/lib/queries";
import { getAccountsOverview } from "@/server/db/analytics";
import { typeLabel, type TransactionType } from "@/lib/financial";

export const dynamic = "force-dynamic";

export default async function EditTransactionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const [rows, overview, categories] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.user_id, user.id)))
      .limit(1),
    getAccountsOverview(user.id),
    getCategoryTree(user.id),
  ]);

  if (rows.length === 0) notFound();
  const t = rows[0];

  // Archived accounts stay selectable so editing a note can't silently move
  // the money to a different account.
  const accounts = overview.accounts.filter(
    (a) => a.is_active || a.id === t.source_account_id || a.id === t.destination_account_id,
  );

  return (
    <>
      <PageHeader title="Edit transaction" subtitle={typeLabel(t.type as TransactionType)} />

      <TransactionForm
        accounts={accounts}
        categories={categories}
        transaction={{
          id: t.id,
          type: t.type as TransactionType,
          amount: t.amount,
          source_account_id: t.source_account_id,
          destination_account_id: t.destination_account_id,
          category_id: t.category_id,
          subcategory_id: t.subcategory_id,
          payment_method: t.payment_method,
          date: t.date,
          merchant: t.merchant,
          description: t.description,
          notes: t.notes,
        }}
      />

      <div className="mt-6">
        <DeleteTransactionButton
          id={t.id}
          redirectTo="/transactions"
          className="btn btn-secondary w-full text-danger"
        >
          Delete transaction
        </DeleteTransactionButton>
      </div>
    </>
  );
}
