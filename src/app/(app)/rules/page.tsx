import { PageHeader } from "@/components/page-header";
import { RulesManager } from "@/components/rules-manager";
import { getCategoryTree } from "@/lib/queries";
import { listRules } from "@/server/db/merchant-rules";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const user = await requireUser();
  const [rules, categories] = await Promise.all([
    listRules(user.id),
    getCategoryTree(user.id),
  ]);

  return (
    <>
      <PageHeader
        title="Categorisation"
        subtitle="What gets filed where, learned from how you categorise things."
      />
      <RulesManager rules={rules} categories={categories} />
    </>
  );
}
