import { PageHeader } from "@/components/page-header";
import { AccountForm } from "@/components/account-form";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function NewAccountPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Add account"
        subtitle="A bank, a card, or cash — anywhere your money sits."
      />
      <AccountForm />
    </>
  );
}
