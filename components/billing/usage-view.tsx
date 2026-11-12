import Link from "next/link";
import { ArrowRight, Clapperboard, Gauge, ImageIcon, Mic, PenLine, Sparkles, type LucideIcon } from "lucide-react";
import { KitStyles, PageHeader, StatusPill } from "@/components/admin/kit";
import { IconBadge } from "@/components/admin/kit/icon-badge";
import { CARD, FOCUS } from "@/components/admin/kit/tones";
import { Meter } from "@/components/ui";
import { cn } from "@/lib/cn";

export type UsageKey = "text" | "image" | "videos" | "voiceCharacters" | "videoCredits";
export type UsageRow = { key: UsageKey; label: string; unit: string; used: number; limit: number };

const ICON: Record<UsageKey, LucideIcon> = { text: PenLine, image: ImageIcon, videos: Clapperboard, voiceCharacters: Mic, videoCredits: Sparkles };
const HINT: Record<UsageKey, string> = {
  text: "Captions, posts and replies BuPulse writes.",
  image: "Designs and AI pictures.",
  videos: "Short videos, up to 30 seconds each.",
  voiceCharacters: "Letters read out in voice-overs.",
  videoCredits: "Video Studio credits. Unused ones do not roll over.",
};

/** One card per thing the plan counts: what is used, out of how many, as a bar. Presentational. */
export function UsageView({ planName, period, rows, videosToday, canBill }: { planName: string; period: string; rows: UsageRow[]; videosToday: { used: number; max: number }; canBill: boolean }) {
  return (
    <>
      <KitStyles />
      <PageHeader icon={Gauge} title="Usage" description={period} actions={<StatusPill tone="info">{planName}</StatusPill>} />
      <ul className="kit-rise grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.filter((r) => r.limit > 0).map((r) => {
          const off = r.limit === 0;
          const left = Math.max(0, r.limit - r.used);
          const near = !off && r.used / r.limit >= 0.9;
          return (
            <li key={r.key} className={cn(CARD, "flex flex-col gap-3 p-4 sm:p-5", off && "opacity-75")}>
              <div className="flex items-start justify-between gap-2">
                <IconBadge icon={ICON[r.key]} tone={off ? "slate" : "blue"} />
                {off ? <StatusPill tone="muted">Not in plan</StatusPill> : near ? <StatusPill tone="warn">Almost used up</StatusPill> : null}
              </div>
              <div className="flex flex-col gap-0.5">
                <h2 className="text-[15px] font-bold">{r.label}</h2>
                <p className="text-[13px] leading-snug text-muted">{HINT[r.key]}</p>
              </div>
              {!off && (
                <>
                  <p className="flex items-baseline gap-1.5">
                    <span className="text-[26px] font-bold leading-none tabular-nums tracking-[-0.02em]">{r.used.toLocaleString("en-US")}</span>
                    <span className="text-[14px] text-muted">
                      of {r.limit.toLocaleString("en-US")} {r.unit}
                    </span>
                  </p>
                  <Meter value={r.used} max={r.limit} label={r.label} />
                  <p className="text-[13px] text-muted">
                    {left.toLocaleString("en-US")} left
                    {/* Videos: at most 30 seconds each and a few a day (lib/usage.ts consumeDailyVideo). */}
                    {r.key === "videos" && ` · ${videosToday.used} of ${videosToday.max} today`}
                  </p>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {rows.some((r) => r.limit === 0) && (
        <p className={cn(CARD, "flex flex-wrap items-center gap-2 p-4 text-[14px] text-muted sm:p-5")}>
          <StatusPill tone="muted">Not in your plan</StatusPill>
          {rows
            .filter((r) => r.limit === 0)
            .map((r) => r.label)
            .join(", ")}
        </p>
      )}
      {canBill && (
        <Link href="/dashboard/billing" className={cn(CARD, FOCUS, "flex min-h-11 items-center justify-between gap-3 p-4 text-[15px] font-semibold no-underline sm:p-5")}>
          Need more? See your plan and add features on Billing
          <ArrowRight aria-hidden className="size-4 shrink-0 text-muted" />
        </Link>
      )}
    </>
  );
}
