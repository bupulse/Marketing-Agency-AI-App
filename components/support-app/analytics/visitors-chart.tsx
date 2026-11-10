import { daysInMonth, eachDay } from "@/lib/analytics/math";
import type { SeriesPoint } from "@/lib/analytics/visitors-shared";
import { AreaChart } from "../charts/area-chart";

// Visitors (or page views, one tap away) per day, week or month: the animated area chart with its crosshair tooltip and
// table view. Old-method days sit in a shaded band and say so in the tooltip and the table, never by colour alone.

/** A week or month the period only partly covers says so ("Nov 2026, 10 days only"), so a short last bar is not read as a fall. */
export function pointLabel(p: SeriesPoint, unit: "day" | "week" | "month"): string {
  if (unit === "day") return p.label;
  const days = eachDay(p.from, p.to).length;
  const full = unit === "week" ? 7 : daysInMonth(p.from.slice(0, 7));
  return days < full ? `${p.label}, ${days} day${days === 1 ? "" : "s"} only` : p.label;
}

export function VisitorsChart({ points, unit }: { points: SeriesPoint[]; unit: "day" | "week" | "month" }) {
  return (
    <AreaChart
      labels={points.map((p) => pointLabel(p, unit))}
      axisLabels={points.map((p) => (unit === "week" ? p.label.replace("Week of ", "") : p.label))}
      metrics={[
        { key: "visitors", name: "Visitors", one: "visitor", many: "visitors", values: points.map((p) => p.visitors) },
        { key: "views", name: "Page views", one: "page view", many: "page views", values: points.map((p) => p.views) },
      ]}
      flags={points.map((p) => p.oldMethod && p.visitors > 0)}
      flagNote="Old method (each browser counted as a visitor)"
      caption={`Visitors per ${unit}`}
      firstColumn={unit === "day" ? "Day" : unit === "week" ? "Week" : "Month"}
    />
  );
}
