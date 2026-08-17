import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/page-header";
import { ImportReview } from "@/components/import-review";
import { getCategoryTree } from "@/lib/queries";
import { getAccountsOverview } from "@/server/db/analytics";
import { listPending } from "@/server/db/import-service";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const user = await requireUser();
  const [overview, categories, pending] = await Promise.all([
    getAccountsOverview(user.id),
    getCategoryTree(user.id),
    listPending(user.id),
  ]);

  const accounts = overview.accounts.filter((a) => a.is_active);

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Import statement" />
        <EmptyState
          title="Add an account first"
          body="A statement belongs to an account, so there needs to be one to import into."
          action={<Link href="/accounts/new" className="btn btn-primary">Add an account</Link>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Import statement"
        subtitle="Upload a bank CSV. Anything already in your ledger is spotted and left alone."
      />
      <ImportReview
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        categories={categories}
        initialPending={pending}
      />
    </>
  );
}
