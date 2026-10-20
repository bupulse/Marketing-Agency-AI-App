import Link from "next/link";
import { money, num } from "@/lib/admin/format";
import { GOAL_PATH, type GoalProgress } from "@/lib/money/goal";
import { HowCalculated, Section, Stat } from "../ui";

const rwf = (n: number) => money(n, "RWF");

/**
 * "Goal": MRR in RWF against the monthly income goal, this launch month's target from the pace plan, and how many
 * more paying clients it takes (Admin -> Revenue and profit). Always in RWF: the goal is set in RWF.
 */
export function GoalSection({ g, newThisMonth, startMonth }: { g: GoalProgress; newThisMonth: number; startMonth: string }) {
  const width = Math.min(100, Math.max(0, g.pct));
  return (
    <Section
      id="goal"
      title={`Goal: ${rwf(g.goalRwf)} a month`}
      description={g.monthNo ? `Month ${g.monthNo} since the launch (${startMonth}). Change the goal or the launch month in Settings.` : `The launch month is ${startMonth}; the monthly targets start then.`}
      action={<Link href="/admin/settings#goal" className="text-sm font-medium underline">Goal settings</Link>}
    >
      <div className="flex flex-col gap-1.5 px-1">
        <div className="flex justify-between text-[13px] font-medium">
          <span className="text-muted">MRR against the goal</span>
          <span>{g.pct}%</span>
        </div>
        <div role="meter" aria-label="MRR against the goal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={width} className="h-3 overflow-hidden rounded-full bg-line">
          <span className="bp-meter-fill block h-full rounded-full bg-brand-gradient" style={{ width: `${width}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="MRR now" value={rwf(g.mrrRwf)} source={`${rwf(g.gapRwf)} to go`} href="#mrr" />
        <Stat
          label={g.monthNo ? `Target for the end of month ${g.monthNo}` : "Target"}
          value={g.targetRwf === null ? "Not started" : rwf(g.targetRwf)}
          source={g.onTrack === null ? "Counts from the launch month" : g.onTrack ? "On track" : `${rwf(Math.max(0, g.targetRwf! - g.mrrRwf))} behind`}
          tone={g.onTrack === false ? "danger" : g.onTrack ? "success" : undefined}
        />
        <Stat label="New paying clients this month" value={num(newThisMonth)} source={g.perMonth === null ? "No paying client yet" : g.perMonth === 0 ? "Goal reached" : `About ${num(g.perMonth)} a month needed`} />
        <Stat label="More paying clients needed" value={g.clientsToGoal === null ? "n/a" : num(g.clientsToGoal)} source={g.arpuRwf === null ? "Needs a first paying client" : `At today's ${rwf(g.arpuRwf)} a client`} />
      </div>
      <HowCalculated>
        <p>MRR is the same as below (each Mobile Money client&apos;s last full payment, a yearly one a twelfth; each card client&apos;s plan price), shown in RWF: money paid in RWF exactly, the rest at the Settings rate.</p>
        <ul>
          <li>Monthly targets follow the pace plan in docs/bizdev/PLAN.md: {GOAL_PATH.map((s, i) => `month ${i + 1} ${Math.round(s * 100)}%`).join(", ")} of the goal, then the whole goal.</li>
          <li>More paying clients needed = the gap divided by today&apos;s MRR per paying client. A month = the gap&apos;s clients spread over the months left to the end of month {GOAL_PATH.length}; clients who stop paying are not counted, so aim higher.</li>
          <li>New paying clients this month = clients whose first payment ever was this month (Kigali time).</li>
        </ul>
      </HowCalculated>
    </Section>
  );
}
