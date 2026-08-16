"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc, errorText } from "@/lib/trpc";
import { categoryInput } from "@/lib/schemas";
import type { Category, CategoryTree } from "@/lib/types";

export function CategoryManager({ tree }: { tree: CategoryTree[] }) {
  const [showHidden, setShowHidden] = useState(false);

  const visibleTree = showHidden
    ? tree
    : tree
        .filter((c) => !c.is_hidden)
        .map((c) => ({ ...c, children: c.children.filter((s) => !s.is_hidden) }));

  const hiddenCount =
    tree.filter((c) => c.is_hidden).length +
    tree.reduce((n, c) => n + c.children.filter((s) => s.is_hidden).length, 0);

  return (
    <div className="space-y-5">
      <AddCategory tree={tree} />

      {hiddenCount > 0 ? (
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
            className="h-4 w-4"
          />
          Show {hiddenCount} hidden
        </label>
      ) : null}

      <ul className="space-y-3">
        {visibleTree.map((parent) => (
          <li key={parent.id} className="card overflow-hidden">
            <CategoryRow category={parent} isParent />
            {parent.children.length > 0 ? (
              <ul className="border-t border-line">
                {parent.children.map((child) => (
                  <li key={child.id} className="border-b border-line last:border-0">
                    <CategoryRow category={child} />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddCategory({ tree }: { tree: CategoryTree[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = trpc.categories.create.useMutation({
    onSuccess: () => {
      // Clear the name after a successful add so the next one is a clean
      // field, but keep the chosen parent — people add siblings in runs.
      setName("");
      router.refresh();
    },
    onError: (e) => setError(errorText(e)),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = categoryInput.safeParse({
      name,
      parent_category_id: parent || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    create.mutate(parsed.data);
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <div>
        <label className="label" htmlFor="new-category-name">
          Add a category
        </label>
        <input
          id="new-category-name"
          className="field"
          required
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Pets, Travel, Kids…"
        />
      </div>

      <div>
        <label className="label" htmlFor="new-category-parent">
          Put it under
        </label>
        <select
          id="new-category-parent"
          className="field"
          value={parent}
          onChange={(e) => setParent(e.target.value)}
        >
          <option value="">Nothing — it&rsquo;s a top-level category</option>
          {tree
            .filter((c) => !c.is_hidden)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        className="btn btn-secondary w-full"
        disabled={create.isPending}
      >
        {create.isPending ? "Adding…" : "Add category"}
      </button>
    </form>
  );
}

function CategoryRow({
  category,
  isParent = false,
}: {
  category: Category;
  isParent?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);

  const refresh = {
    onSuccess: () => router.refresh(),
    onError: (e: unknown) => window.alert(errorText(e)),
  };

  const rename = trpc.categories.rename.useMutation({
    onSuccess: () => {
      setEditing(false);
      router.refresh();
    },
    onError: (e) => window.alert(errorText(e)),
  });
  const setHidden = trpc.categories.setHidden.useMutation(refresh);
  const remove = trpc.categories.delete.useMutation(refresh);

  if (editing) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = categoryInput.shape.name.safeParse(name);
          if (!parsed.success) {
            window.alert(parsed.error.issues[0].message);
            return;
          }
          rename.mutate({ id: category.id, name: parsed.data });
        }}
        className={`flex items-center gap-2 p-3 ${isParent ? "" : "pl-6"}`}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="field flex-1"
          maxLength={40}
          autoFocus
          required
        />
        <button
          type="submit"
          className="btn btn-primary h-9 min-h-9 px-3 text-sm"
          disabled={rename.isPending}
        >
          {rename.isPending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="btn btn-ghost h-9 min-h-9 px-2 text-sm"
          onClick={() => {
            setName(category.name);
            setEditing(false);
          }}
        >
          Cancel
        </button>
      </form>
    );
  }

  const busy = setHidden.isPending || remove.isPending;

  return (
    <div
      className={`flex items-center gap-2 p-3 ${isParent ? "" : "pl-6"} ${
        category.is_hidden ? "opacity-50" : ""
      }`}
    >
      <span
        className={`min-w-0 flex-1 truncate ${
          isParent ? "font-display font-semibold text-ink" : "text-sm text-ink-soft"
        }`}
      >
        {category.name}
        {category.is_preset ? (
          <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
            preset
          </span>
        ) : null}
      </span>

      <button
        type="button"
        onClick={() => setEditing(true)}
        className="btn btn-ghost h-8 min-h-8 px-2 text-xs"
      >
        Rename
      </button>

      {category.is_hidden ? (
        <button
          type="button"
          disabled={busy}
          className="btn btn-ghost h-8 min-h-8 px-2 text-xs"
          onClick={() => setHidden.mutate({ id: category.id, hidden: false })}
        >
          Unhide
        </button>
      ) : category.is_preset ? (
        <button
          type="button"
          disabled={busy}
          className="btn btn-ghost h-8 min-h-8 px-2 text-xs"
          onClick={() => setHidden.mutate({ id: category.id, hidden: true })}
        >
          Hide
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          className="btn btn-ghost h-8 min-h-8 px-2 text-xs text-danger"
          onClick={() => {
            const ok = window.confirm(
              `Remove "${category.name}"? If any expenses use it, it's hidden instead so your history stays intact.`,
            );
            if (ok) remove.mutate({ id: category.id });
          }}
        >
          Remove
        </button>
      )}
    </div>
  );
}
