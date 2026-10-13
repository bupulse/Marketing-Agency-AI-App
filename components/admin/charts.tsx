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
  format,
}: {
  labels: string[];
  series: Series[];
  cents?: boolean;
  summary: string;
  /** How a USD-cents value is printed (the admin's display currency, components/admin/money.tsx); default as stored. */
  format?: (cents: number) => string;
}) {
  const all = series.flatMap((s) => s.values);
  if (labels.length < 2 || all.length === 0) return null;
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i / (labels.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const fmt = (v: number) => (cents ? (format ?? money)(v) : v.toLocaleString("en-US"));
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

/**
 * Monthly bars, two per month side by side (e.g. revenue and costs), from zero, with the month under each pair and
 * a legend. Exact values are in the table next to it and in each bar's tooltip. Values in USD cents.
 */
export function MonthBars({ months, a, b, summary, format = money }: { months: string[]; a: { name: string; color: string; values: number[] }; b: { name: string; color: string; values: number[] }; summary: string; format?: (cents: number) => string }) {
  if (months.length === 0) return null;
  const max = Math.max(1, ...a.values, ...b.values);
  const W = 600;
  const H = 170;
  const base = H - 22;
  const slot = W / months.length;
  const bar = Math.max(4, Math.min(22, slot / 3));
  const h = (v: number) => (Math.max(0, v) / max) * (base - 8);
  const label = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="h-44 w-full">
        <line x1={0} x2={W} y1={base} y2={base} stroke="var(--bp-line)" strokeWidth={1} />
        {months.map((m, i) => {
          const cx = slot * i + slot / 2;
          return (
            <g key={m}>
              <rect x={cx - bar - 1} y={base - h(a.values[i])} width={bar} height={h(a.values[i])} rx={3} fill={a.color}>
                <title>{`${m} ${a.name}: ${format(a.values[i])}`}</title>
              </rect>
              <rect x={cx + 1} y={base - h(b.values[i])} width={bar} height={h(b.values[i])} rx={3} fill={b.color}>
                <title>{`${m} ${b.name}: ${format(b.values[i])}`}</title>
              </rect>
              <text x={cx} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--bp-muted)">
                {label(m)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted">
        <span>Highest month {format(max)}</span>
        <span className="flex gap-3">
          {[a, b].map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </span>
      </figcaption>
    </figure>
  );
}

/** A labelled progress bar against a limit (AI spend vs cap). Turns red from 90%. */
export function Gauge({ value, max, label, text }: { value: number; max: number; label: string; text: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="font-medium text-muted">{label}</span>
        <span className="tabular-nums">{text}</span>
      </div>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={text} className="h-2.5 overflow-hidden rounded-full bg-soft">
        <span className="block h-full rounded-full" style={{ width: `${Math.max(1, pct)}%`, background: pct >= 90 ? "var(--bp-danger)" : "var(--color-pulse-blue)" }} />
      </div>
    </div>
  );
}
