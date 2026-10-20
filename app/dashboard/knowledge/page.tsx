import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { SECTION_ICONS } from "@/components/knowledge/section-icons";
import { Badge, GlassCard } from "@/components/ui";
import { Progress } from "@/components/knowledge/progress";
import { cn } from "@/lib/cn";
import { localParts, safeZone } from "@/lib/autopilot/timezone";
import { knowledgeProgress } from "@/lib/knowledge/overview";
import { KNOWLEDGE_SECTIONS, overallPercent } from "@/lib/knowledge/sections";
import { can } from "@/lib/team/roles";

export const metadata = { title: "Business info" };

export default async function KnowledgePage() {
  const { business, role, entitlements } = await getAppContext();
  const p = localParts(new Date(), safeZone(business.timezone));
  const today = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  const progress = await knowledgeProgress(business, today);
  const overall = overallPercent(progress);
  // Members get no purchase prompts (lib/team/roles.ts upgrade).
  const canUpgrade = can(role, "upgrade");

  return (
    <>
      <PageHeader
        title="Business info"
        description="Everything BuPulse knows about your business. The more you add, the more your posts, designs and chat replies sound like you and get the facts right."
      />
      <GlassCard className="flex flex-col gap-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Your business info is {overall}% complete</h2>
          <span className="text-[13px] text-muted">Required fields are marked with *</span>
        </div>
        <Progress percent={overall} label="Business info complete" />
      </GlassCard>

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {KNOWLEDGE_SECTIONS.map((s) => {
          const Icon = SECTION_ICONS[s.key];
          const p = progress[s.key];
          const soon = s.status === "coming_soon";
          const missingFeature = s.feature && !entitlements.usable.has(s.feature);
          const viewOnly = s.permission && !can(role, s.permission);
          const body = (
            <GlassCard interactive={!soon} className={cn("flex h-full flex-col gap-3 p-5", soon && "opacity-80")}>
              <div className="flex items-start justify-between gap-3">
                <span className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-2xl", soon ? "bg-soft text-muted" : "bg-brand-gradient text-white")}>
                  <Icon aria-hidden className="size-5" />
                </span>
                {soon ? (
                  <Badge tone="neutral">Coming soon</Badge>
                ) : missingFeature ? (
                  canUpgrade ? (
                    <Badge tone="violet">Add to your plan</Badge>
                  ) : (
                    <Badge tone="neutral">Not in your plan</Badge>
                  )
                ) : viewOnly ? (
                  <Badge tone="neutral">
                    <Lock aria-hidden className="mr-1 inline size-3" />
                    Admins edit
                  </Badge>
                ) : typeof p?.percent === "number" ? (
                  <Badge tone={p.percent >= 100 ? "success" : "blue"}>{p.percent}% complete</Badge>
                ) : null}
              </div>
              <div className="flex flex-col gap-1">
                <h2 className="text-[17px] font-semibold">
                  {s.title}
                  {typeof p?.percent === "number" && !soon && <span className="sr-only">, {p.percent}% complete</span>}
                </h2>
                <p className="text-[14px] text-muted">{s.description}</p>
              </div>
              {typeof p?.percent === "number" && !soon && <Progress percent={p.percent} label={`${s.title} complete`} />}
              <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[14px]">
                <span className="text-muted">{soon ? "Arriving in the next update" : p?.summary}</span>
                {!soon && <ArrowRight aria-hidden className="size-4 shrink-0 text-muted" />}
              </div>
            </GlassCard>
          );
          return (
            <li key={s.key}>
              {soon ? (
                body
              ) : (
                <Link href={s.href} className="block h-full no-underline" aria-label={`${s.title}${p?.summary ? `: ${p.summary}` : ""}`}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
