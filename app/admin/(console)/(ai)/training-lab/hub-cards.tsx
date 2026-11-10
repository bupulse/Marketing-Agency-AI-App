import { HeartPulse } from "lucide-react";
import { EmptyState, ExpandCard, SectionCard, SectionGrid, StatusPill } from "@/components/admin/kit";
import { HEALTH_SHOWN, type HealthIssue } from "@/lib/training-lab/health";
import { LAB_TABS } from "./lab-tabs";

const BASE = "/admin/training-lab";

/**
 * The top of the Training Lab: one card per part (add, finished reels, team, editor, words) and the Lab's health as
 * a card that opens on hover or tap (open from the start when something needs fixing).
 */
export function LabHubCards({ reelsWaiting, health }: { reelsWaiting: number; health: HealthIssue[] | null }) {
  const figures: Partial<Record<(typeof LAB_TABS)[number]["key"], { value?: string; valueLabel?: string; count?: number; countLabel?: string }>> = {
    reels: { value: String(reelsWaiting), valueLabel: reelsWaiting === 1 ? "reel without your verdict" : "reels without your verdict", count: reelsWaiting, countLabel: `${reelsWaiting} reels waiting for your verdict` },
  };
  return (
    <>
      <SectionGrid cols={4} className="xl:grid-cols-5">
        {LAB_TABS.filter((t) => t.key !== "library").map((t) => (
          <SectionCard key={t.key} href={t.href} icon={t.icon} tone="violet" title={t.label === "Add" ? "Add an example" : t.label} hint={t.hint} {...figures[t.key]} countTone="violet" row />
        ))}
      </SectionGrid>
      {health && <LabHealth issues={health} />}
    </>
  );
}

/** What makes examples useless or risky, at most 8 with how many more, each linked to its example. */
function LabHealth({ issues }: { issues: HealthIssue[] }) {
  const shown = issues.slice(0, HEALTH_SHOWN);
  return (
    <ExpandCard
      icon={HeartPulse}
      tone={issues.length ? "orange" : "green"}
      title="Lab health"
      summary={issues.length ? `${issues.length} thing${issues.length === 1 ? "" : "s"} to fix so the engines can use every example.` : "All examples are ready to use."}
      aside={<StatusPill tone={issues.length ? "warn" : "good"} dot>{issues.length ? `${issues.length} to fix` : "All good"}</StatusPill>}
    >
      {issues.length === 0 ? (
        <EmptyState tone="good" title="All examples are ready to use." />
      ) : (
        <section aria-label="Lab health" className="flex min-w-0 flex-col gap-2">
          <ul className="flex min-w-0 flex-col gap-1.5 text-[14px]">
            {shown.map((i, k) => (
              <li key={`${i.id}-${k}`} className="min-w-0 break-words rounded-xl bg-soft/70 px-3 py-2 dark:bg-white/[0.04]">
                <a href={`${BASE}#ex-${i.id}`} className="font-semibold text-pulse-blue underline">{i.title}</a>: {i.problem}
              </li>
            ))}
          </ul>
          {issues.length > shown.length && <p className="text-[13px] text-muted">and {issues.length - shown.length} more</p>}
        </section>
      )}
    </ExpandCard>
  );
}
