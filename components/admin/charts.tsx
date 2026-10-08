import { money } from "@/lib/admin/format";

type Series = { name: string; color: string; values: number[] };

const W = 600;
const H = 160;
const PAD = 6;

/**
 * Plain SVG line chart (no library). Each series is one coloured line; a screen-reader table summary
 * is provided through `summary`. Values are USD cents when `cents` is set.
 */
export function LineChart({
  labels,
  series,
  cents,
  summary,
}: {
  labels: string[];
  series: Series[];
  cents?: boolean;
  summary: string;
}) {
  const all = series.flatMap((s) => s.values);
  if (labels.length < 2 || all.length === 0) return null;
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i / (labels.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const fmt = (v: number) => (cents ? money(v) : v.toLocaleString("en-US"));
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="h-40 w-full overflow-visible">
        <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke="var(--bp-line)" strokeWidth={1} />
        {series.map((s) => (
          <polyline
            key={s.name}
            fill="none"
            stroke={s.color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
          />
        ))}
      </svg>
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          {labels[0]} to {labels[labels.length - 1]} · high {fmt(max)}
          {min < 0 ? ` · low ${fmt(min)}` : ""}
        </span>
        <span className="flex gap-3">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </span>
      </figcaption>
    </figure>
  );
}

/** Tiny line with no axes, for a stat tile. */
export function Spark({ values, color = "var(--color-pulse-blue)", label }: { values: number[]; color?: string; label: string }) {
  if (values.length < 2 || values.every((v) => v === 0)) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 24}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" role="img" aria-label={label} className="h-8 w-full" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Horizontal bars in CSS: label, bar, value. */
export function Bars({ rows, color = "var(--color-pulse-blue)" }: { rows: { label: string; value: number; text: string }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-[14px]">
          <span className="truncate" title={r.label}>
            {r.label}
          </span>
          <span aria-hidden className="h-2.5 overflow-hidden rounded-full bg-soft">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: color }} />
          </span>
          <span className="tabular-nums text-muted">{r.text}</span>
        </li>
      ))}
    </ul>
  );
}
