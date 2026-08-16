export type Frequency = "weekly" | "monthly" | "yearly";

export type Category = {
  id: string;
  user_id: string;
  name: string;
  parent_category_id: string | null;
  is_preset: boolean;
  is_hidden: boolean;
  created_at: string;
};




export type RecurringPattern = {
  id: string;
  user_id: string;
  category_id: string;
  subcategory_id: string | null;
  account_id: string;
  merchant_or_note_pattern: string | null;
  note_key: string;
  average_amount: number;
  frequency: Frequency;
  avg_interval_days: number;
  occurrence_count: number;
  confidence_score: number;
  last_detected_date: string;
  next_due_date: string | null;
  is_confirmed: boolean;
  is_dismissed: boolean;
};


/** A parent category with its (visible) subcategories attached. */
export type CategoryTree = Category & { children: Category[] };

export function buildCategoryTree(rows: Category[]): CategoryTree[] {
  const parents = rows
    .filter((c) => !c.parent_category_id)
    .map((c) => ({ ...c, children: [] as Category[] }));
  const byId = new Map(parents.map((p) => [p.id, p]));
  for (const row of rows) {
    if (!row.parent_category_id) continue;
    byId.get(row.parent_category_id)?.children.push(row);
  }
  for (const p of parents) {
    p.children.sort((a, b) => a.name.localeCompare(b.name));
  }
  return parents.sort((a, b) => a.name.localeCompare(b.name));
}
