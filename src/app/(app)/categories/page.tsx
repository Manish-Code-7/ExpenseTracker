import { requireUser } from "@/server/session";
import { PageHeader } from "@/components/page-header";
import { CategoryManager } from "@/components/category-manager";
import { getAllCategories } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const user = await requireUser();
  const tree = await getAllCategories(user.id);

  return (
    <>
      <PageHeader
        title="Categories"
        subtitle="Presets are here to start with. Hide the ones you don't use and add your own."
      />
      <CategoryManager tree={tree} />
    </>
  );
}
