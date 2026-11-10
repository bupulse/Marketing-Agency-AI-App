import { Briefcase, FileText, Funnel, Globe } from "lucide-react";
import { requirePermission } from "@/lib/admin/auth";
import { Bars } from "@/components/admin/charts";
import { ChoiceTiles, chosen, DataList, EmptyState, PageHeader } from "@/components/admin/kit";
import { Panel, RangeTabs } from "@/components/admin/ui";
import { num, parseRange, pct } from "@/lib/admin/format";
import { getFunnel, getWhatsWorking } from "@/lib/analytics/queries";
import type { Ranked } from "@/lib/analytics/types";
import { lastOldMethodDayIn } from "@/lib/analytics/visitors";
import { oldMethodNote } from "@/lib/analytics/visitors-shared";

export const metadata = { title: "Funnels" };

const BY = {
  source: { label: "Traffic source", first: "Source", hint: "Where visitors came from", description: "Where visitors came from (referrer or utm_source), and how far they got.", icon: Globe },
  industry: { label: "Industry", first: "Industry", hint: "Businesses created, and paying", description: "Businesses created, and how many of them now pay.", icon: Briefcase },
  page: { label: "Landing page", first: "Page", hint: "First page of the visit", description: "The first page of the visit that ended in a sign-up.", icon: FileText },
} as const;
type By = keyof typeof BY;

function RankedList({ rows, caption, first }: { rows: Ranked[]; caption: string; first: string }) {
  const hasVisits = rows.some((r) => r.visits != null);
  return (
    <DataList<Ranked>
      caption={caption}
      rows={rows}
      rowKey={(r) => r.key || "(none)"}
      columns={[
        { key: "key", header: first, primary: true, className: "max-w-[16rem] truncate", cell: (r) => r.key || "(none)" },
        ...(hasVisits ? [{ key: "visits", header: "Visits", align: "right" as const, cell: (r: Ranked) => num(r.visits ?? 0) }] : []),
        { key: "signups", header: "Sign-ups", align: "right", cell: (r) => num(r.signups) },
        { key: "paid", header: "Paid", align: "right", cell: (r) => num(r.paid) },
        { key: "signupPct", header: "Sign-up rate", align: "right", cell: (r) => pct(r.signupPct) },
        { key: "paidPct", header: "Paid rate", align: "right", cell: (r) => pct(r.paidPct) },
      ]}
      empty={<EmptyState title="No data in this range yet." hint="Pick a longer range above." />}
    />
  );
}

export default async function FunnelsPage({ searchParams }: PageProps<"/admin/funnels">) {
  await requirePermission("content"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const { key, range } = parseRange(sp.range);
  const by = chosen(sp, "by", Object.keys(BY), "source") as By;
  const [funnel, working, lastOld] = await Promise.all([getFunnel(range), getWhatsWorking(range), lastOldMethodDayIn(range)]);
  const oldNote = oldMethodNote(lastOld);
  const none = funnel.steps.every((s) => s.count === 0);
  const rows = by === "industry" ? working.industries : by === "page" ? working.landingPages : working.sources;
  return (
    <>
      <PageHeader icon={Funnel} tone="pink" title="Funnels" description={`Visit, sign-up, onboarded, paid: how many people reach each step, ${range.from} to ${range.to}. Counts are distinct people.`} actions={<RangeTabs current={key} base="/admin/funnels" extra={by !== "source" ? { by } : undefined} />} />
      <Panel icon={Funnel} tone="pink" title="Overall funnel" description="Each bar is a step; the percentage is how many of the step before got here.">
        {none ? (
          <EmptyState title="No visits or sign-ups in this range yet." />
        ) : (
          <>
            <Bars color="var(--color-pulse-violet)" rows={funnel.steps.map((s) => ({ label: s.label, value: s.count, text: `${num(s.count)}${s.key === "visitors" && oldNote ? " (partly old method)" : ""}${s.fromPreviousPct != null ? ` · ${pct(s.fromPreviousPct)} of previous step` : ""}` }))} />
            {oldNote && <p className="pt-3 text-sm text-muted">{oldNote}</p>}
          </>
        )}
      </Panel>
      <ChoiceTiles label="Break the funnel down by" param="by" base="/admin/funnels" params={sp} current={by} allValue="source" options={(Object.keys(BY) as By[]).map((k) => ({ value: k, label: BY[k].label, hint: BY[k].hint, icon: BY[k].icon, tone: "pink" }))} />
      <Panel icon={BY[by].icon} tone="pink" title={`By ${BY[by].label.toLowerCase()}`} description={BY[by].description}>
        <RankedList rows={rows} caption={`Funnel by ${BY[by].label.toLowerCase()}`} first={BY[by].first} />
      </Panel>
    </>
  );
}
