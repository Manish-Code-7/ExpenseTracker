"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { money } from "@/lib/format";

export type CategoryDatum = {
  id: string;
  name: string;
  total: number;
  children: { id: string; name: string; total: number }[];
};

/**
 * Categories are identified by their axis labels, not by colour — the only
 * colours on this dashboard belong to payment methods. Tap a bar with
 * subcategories to drill in.
 */
export function CategoryChart({ data }: { data: CategoryDatum[] }) {
  const [drilled, setDrilled] = useState<string | null>(null);

  const parent = drilled ? data.find((d) => d.id === drilled) : null;
  const rows = parent
    ? [...parent.children]
        .filter((c) => c.total > 0)
        .sort((a, b) => b.total - a.total)
    : data;

  const untagged = parent
    ? parent.total - parent.children.reduce((s, c) => s + c.total, 0)
    : 0;

  const chartRows =
    parent && untagged > 0.005
      ? [...rows, { id: "__rest", name: "Not sub-tagged", total: untagged }]
      : rows;

  const height = Math.max(120, chartRows.length * 38 + 12);

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="font-display text-base font-semibold text-ink">
          {parent ? parent.name : "By category"}
        </h2>
        {parent ? (
          <button
            type="button"
            onClick={() => setDrilled(null)}
            className="ml-auto text-sm font-medium text-ink-soft underline"
          >
            All categories
          </button>
        ) : (
          <span className="ml-auto text-xs text-ink-muted">
            Tap a bar to drill in
          </span>
        )}
      </div>

      {chartRows.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">
          Nothing in this category yet.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart
            data={chartRows}
            layout="vertical"
            margin={{ top: 0, right: 64, bottom: 0, left: 0 }}
            barCategoryGap={10}
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              width={104}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--ink-soft)", fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: "color-mix(in oklab, var(--ink) 7%, transparent)" }}
              formatter={(value: unknown) => [money(Number(value)), "Spend"] as [string, string]}
              contentStyle={{
                background: "var(--glass-strong)",
                backdropFilter: "blur(12px)",
                border: "1px solid var(--glass-border)",
                borderRadius: 12,
                boxShadow: "var(--glass-shadow)",
                fontSize: 12,
                color: "var(--ink)",
              }}
              labelStyle={{ color: "var(--ink-soft)" }}
            />
            <Bar
              dataKey="total"
              radius={[0, 4, 4, 0]}
              barSize={18}
              isAnimationActive={false}
              onClick={(data: unknown) => {
                if (parent) return;
                const entry = data as Partial<CategoryDatum> | undefined;
                if (entry?.id && entry.children?.some((c) => c.total > 0)) {
                  setDrilled(entry.id);
                }
              }}
            >
              {chartRows.map((row) => {
                const drillable =
                  !parent &&
                  (row as CategoryDatum).children?.some((c) => c.total > 0);
                return (
                  <Cell
                    key={row.id}
                    fill="var(--ink-soft)"
                    cursor={drillable ? "pointer" : "default"}
                  />
                );
              })}
              <LabelList
                dataKey="total"
                position="right"
                offset={8}
                formatter={(value: React.ReactNode) => money(Number(value))}
                style={{
                  fill: "var(--ink)",
                  fontSize: 12,
                  fontVariantNumeric: "tabular-nums",
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}
