import type { TrendPoint } from "@/lib/analytics/compute";
import { formatCompact, formatShortDate } from "./format";

const W = 600;
const H = 120;
const PAD = { top: 8, bottom: 2, left: 4, right: 4 };

/** One bar series as plain SVG: scales with its container, no script, works in Safari and on phones. */
function Bars({ points, pick, color, label }: { points: TrendPoint[]; pick: (p: TrendPoint) => number; color: string; label: string }) {
  const max = Math.max(1, ...points.map(pick));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / points.length;
  const bar = Math.max(2, Math.min(28, slot * 0.7));
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <figure className="m-0 flex flex-col gap-1">
      <figcaption className="flex items-baseline justify-between text-[13px] text-muted">
        <span className="font-medium text-text">{label}</span>
        <span>Peak {formatCompact(max === 1 && points.every((p) => pick(p) === 0) ? 0 : max)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} over time`} className="h-auto w-full" preserveAspectRatio="none">
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="var(--bp-line)" strokeWidth="1" />
        {points.map((p, i) => {
          const h = (pick(p) / max) * innerH;
          const x = PAD.left + slot * i + (slot - bar) / 2;
          return (
            <rect key={p.start} x={x} y={H - PAD.bottom - h} width={bar} height={Math.max(pick(p) > 0 ? 2 : 0, h)} rx={Math.min(4, bar / 2)} fill={color}>
              <title>{`${formatShortDate(p.start)}: ${pick(p).toLocaleString("en")}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="flex justify-between text-[12px] text-muted"><span>{formatShortDate(first.start)}</span><span>{formatShortDate(last.start)}</span></div>
    </figure>
  );
}

export function TrendChart({ points, unit }: { points: TrendPoint[]; unit: "day" | "week" }) {
  return (
    <div className="flex flex-col gap-5">
      <Bars points={points} pick={(p) => p.reach} color="var(--color-pulse-blue)" label={`Reach per ${unit}`} />
      <Bars points={points} pick={(p) => p.engagement} color="var(--color-pulse-violet)" label={`Engagement per ${unit}`} />
      <p className="text-[13px] text-muted">Each bar adds up the posts you published that {unit}{unit === "week" ? " (7 days)" : ""}. Numbers keep growing for a few days after a post goes out.</p>
    </div>
  );
}
