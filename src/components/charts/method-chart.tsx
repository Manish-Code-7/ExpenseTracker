"use client";

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

export type MethodDatum = {
  id: string;
  name: string;
  color: string;
  total: number;
};

/**
 * One shared rupee axis across every method, so bar lengths are directly
 * comparable. Budget progress is a separate question and lives in its own
 * section — putting per-method limits on this axis would give each bar its own
 * scale.
 */
export function MethodChart({ data }: { data: MethodDatum[] }) {
  const rows = [...data].sort((a, b) => b.total - a.total);
  const height = Math.max(120, rows.length * 38 + 12);

  return (
    <section className="card p-4">
      <h2 className="mb-3 font-display text-base font-semibold text-ink">
        By payment method
      </h2>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">
          Nothing spent this month yet.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 0, right: 64, bottom: 0, left: 0 }}
            barCategoryGap={10}
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              width={112}
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
            >
              {rows.map((row) => (
                <Cell key={row.id} fill={row.color} />
              ))}
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
