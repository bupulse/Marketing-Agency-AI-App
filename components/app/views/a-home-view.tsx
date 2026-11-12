import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, BarChart3, Circle, CircleCheck, Image as ImageIcon, LayoutDashboard, Package, Palette, PenLine, Rocket, Users, type LucideIcon } from "lucide-react";
import { ExpandCard, PageHeader, StatGrid, StatTile } from "@/components/admin/kit";
import { CARD, FOCUS } from "@/components/admin/kit/tones";
import { ActionTiles, type ActionTile } from "@/components/app/kit/a-action-tiles";
import { Meter } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ChecklistItem } from "@/lib/home-checklist";

/** Everything Home shows, as plain data (the page loads it; the dev preview passes made-up data). */
export type HomeViewData = {
  firstName: string;
  businessName: string;
  logoUrl: string | null;
  swatches: string[];
  voiceLabel: string | null;
  canEditBrand: boolean;
  checklist: ChecklistItem[];
  counts: { products: number; content: number; leads: number; designs: number };
  recentProducts: { id: string; name: string; line: string }[];
  recentLeads: { id: string; name: string; line: string }[];
  meters: { label: string; value: number; max: number }[];
  planEnded: boolean;
  /** "What do you want to do?": the Create actions the role and plan allow. */
  actions: ActionTile[];
};

/**
 * Home (redesigned 12 Nov 2026, "cards to choose, not too much on one page"): a header, the set-up steps still to do,
 * four big choices ("What do you want to do?"), the four numbers that matter, and the rest (brand, usage, products,
 * leads) folded into cards that open on hover, tap or focus.
 */
export function HomeView({ data, top }: { data: HomeViewData; /** The quiz card and the essentials banner, when they apply. */ top?: ReactNode }) {
  const { checklist, counts } = data;
  const todo = checklist.filter((c) => !c.done);
  const done = checklist.length - todo.length;

  return (
    <>
      <PageHeader icon={LayoutDashboard} title={`Welcome, ${data.firstName}`} description="Your marketing at a glance. Pick what you want to do next." />

      {top}

      {todo.length > 0 && <SetupCard todo={todo} done={done} total={checklist.length} />}

      {data.actions.length > 0 && (
        <section aria-labelledby="home-do" className="flex flex-col gap-3">
          <SectionTitle id="home-do" title="What do you want to do?" hint="Tap one to start." />
          <ActionTiles items={data.actions} />
        </section>
      )}

      <section aria-labelledby="home-numbers" className="flex flex-col gap-3">
        <SectionTitle id="home-numbers" title="Your numbers" hint="Tap a number to see the list behind it." />
        <StatGrid cols={4}>
          <StatTile icon={Package} label="Products & services" value={counts.products} hint="What you sell." href="/dashboard/knowledge/products" />
          <StatTile icon={PenLine} tone="violet" label="Posts and captions" value={counts.content} hint="Made for you so far." href="/dashboard/content" />
          <StatTile icon={Users} tone="indigo" label="Leads" value={counts.leads} hint="People who asked about you." href="/dashboard/leads" />
          <StatTile icon={ImageIcon} tone="pink" label="Designs" value={counts.designs} hint="Branded pictures made." href="/dashboard/designs" />
        </StatGrid>
      </section>

      <section aria-labelledby="home-more" className="flex flex-col gap-3">
        <SectionTitle id="home-more" title="More about your account" hint="Open a card for the details." />
        <div className="kit-rise grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
          <BrandCard data={data} />
          <UsageCard meters={data.meters} planEnded={data.planEnded} />
          <ListCard
            icon={Package}
            title="Products & services"
            summary={data.recentProducts.length ? `Latest: ${data.recentProducts[0].name}` : "Nothing added yet"}
            items={data.recentProducts.map((p) => ({ ...p, href: `/dashboard/knowledge/products/${p.id}` }))}
            empty={
              <>
                Add what you sell in <Link href="/dashboard/knowledge" className="font-semibold">Business info</Link>: products, services, events and offers.
              </>
            }
            more={{ href: "/dashboard/knowledge/products", label: "See all products" }}
          />
          <ListCard
            icon={Users}
            tone="indigo"
            title="New leads"
            summary={data.recentLeads.length ? `Latest: ${data.recentLeads[0].name}` : "No leads yet"}
            items={data.recentLeads}
            empty="They show up here once visitors chat with your website widget."
            more={{ href: "/dashboard/leads", label: "See all leads" }}
          />
        </div>
      </section>
    </>
  );
}

function SectionTitle({ id, title, hint }: { id: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-1">
      <h2 id={id} className="text-[18px] font-bold tracking-[-0.02em]">
        {title}
      </h2>
      {hint && <p className="text-[13.5px] text-muted">{hint}</p>}
    </div>
  );
}

/** The set-up steps not done yet, with how far along the company is. A step the role cannot open says who to ask. */
function SetupCard({ todo, done, total }: { todo: ChecklistItem[]; done: number; total: number }) {
  return (
    <section aria-labelledby="home-setup" className={cn(CARD, "relative flex flex-col gap-4 overflow-hidden p-4 sm:p-5")}>
      <span aria-hidden className="pointer-events-none absolute -right-14 -top-14 size-40 rounded-full bg-brand-gradient opacity-[0.10] blur-2xl" />
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="inline-flex size-10 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#2f6bff,#7b5cff)] text-white">
          <Rocket className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 id="home-setup" className="text-[17px] font-bold tracking-[-0.01em]">
            Finish setting up
          </h2>
          <p className="text-[13.5px] text-muted">
            {done} of {total} done. {todo.length === 1 ? "One step left." : `${todo.length} steps left.`}
          </p>
        </div>
        <Meter value={done} max={total} label="Set-up steps done" className="w-full sm:w-40" />
      </div>
      <ul className="kit-rise grid grid-cols-1 gap-2 sm:grid-cols-2">
        {todo.map(({ label, href, ask }) => (
          <li key={label}>
            {ask ? (
              <div className="flex min-h-14 items-center gap-3 rounded-2xl border border-line px-3.5 py-2">
                <Circle aria-hidden className="size-5 shrink-0 text-muted" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[15px] font-semibold">{label}</span>
                  <span className="text-[13px] text-muted">{ask}</span>
                </span>
              </div>
            ) : (
              <Link
                href={href}
                className={cn(
                  "group flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-2 text-text no-underline transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-pulse-blue/40 motion-reduce:transform-none motion-reduce:transition-none dark:bg-white/[0.03]",
                  FOCUS,
                )}
              >
                <Circle aria-hidden className="size-5 shrink-0 text-muted group-hover:hidden" />
                <CircleCheck aria-hidden className="hidden size-5 shrink-0 text-pulse-blue group-hover:block" />
                <span className="flex-1 text-[15px] font-semibold">{label}</span>
                <span className="sr-only">Not done yet</span>
                <ArrowRight aria-hidden className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function BrandCard({ data }: { data: HomeViewData }) {
  const summary = [data.swatches.length ? `${data.swatches.length} colours` : "No colours yet", data.voiceLabel ? `Voice: ${data.voiceLabel}` : "No voice chosen yet"].join(" · ");
  return (
    <ExpandCard icon={Palette} tone="violet" title="Your brand" summary={summary}>
      <div className="flex flex-wrap items-center gap-4">
        {data.logoUrl ? (
          // Signed Supabase URL: plain img, no remotePatterns needed.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.logoUrl} alt={`${data.businessName} logo`} width={48} height={48} className="size-12 shrink-0 rounded-2xl bg-white object-contain p-1" />
        ) : (
          <span aria-hidden className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-soft text-muted">
            <Palette className="size-5" />
          </span>
        )}
        {data.swatches.length > 0 ? (
          <ul aria-label="Brand colours" className="flex gap-1.5">
            {data.swatches.map((c) => (
              <li key={c} title={c} className="size-7 rounded-full border border-line" style={{ background: c }}>
                <span className="sr-only">{c}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-[13px] text-muted">No colours yet</span>
        )}
        {data.canEditBrand && (
          <Link href="/dashboard/brand" className="ml-auto inline-flex min-h-11 items-center gap-1 text-[14px] font-semibold">
            Edit brand <ArrowRight aria-hidden className="size-4" />
          </Link>
        )}
      </div>
    </ExpandCard>
  );
}

function UsageCard({ meters, planEnded }: { meters: HomeViewData["meters"]; planEnded: boolean }) {
  const first = meters.find((m) => m.max > 0);
  const summary = planEnded ? "Your plan has ended" : first ? `${first.label}: ${first.value} of ${first.max} used` : "Nothing in your plan yet";
  return (
    <ExpandCard icon={BarChart3} tone="blue" title="What you used this period" summary={summary} defaultOpen={planEnded}>
      <div className="flex flex-col gap-4">
        {planEnded && <p className="text-sm text-muted">Your plan has ended, so nothing new can be made until a plan is chosen. Everything you made is saved.</p>}
        <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2", planEnded && "opacity-60")}>
          {meters.map((m) => {
            const unavailable = m.max === 0;
            return (
              <div key={m.label} className={cn("flex flex-col gap-2", unavailable && "opacity-60")}>
                <div className="flex justify-between gap-2 text-sm">
                  <span>{m.label}</span>
                  <span className="text-muted tabular-nums">{unavailable ? "Not in plan" : `${m.value} / ${m.max}`}</span>
                </div>
                <Meter value={m.value} max={m.max} label={m.label} />
              </div>
            );
          })}
        </div>
        <Link href="/dashboard/usage" className="inline-flex min-h-11 w-fit items-center gap-1 text-[14px] font-semibold">
          See the details <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </ExpandCard>
  );
}

function ListCard({
  icon,
  tone = "blue",
  title,
  summary,
  items,
  empty,
  more,
}: {
  icon: LucideIcon;
  tone?: "blue" | "indigo";
  title: string;
  summary: string;
  items: { id: string; name: string; line: string; href?: string }[];
  empty: ReactNode;
  more: { href: string; label: string };
}) {
  return (
    <ExpandCard icon={icon} tone={tone} title={title} summary={summary}>
      <div className="flex flex-col gap-2">
        {items.length === 0 ? (
          <p className="rounded-2xl bg-soft px-4 py-5 text-center text-[14px] text-muted">{empty}</p>
        ) : (
          <ul className="flex flex-col">
            {items.map((i) => {
              const body = (
                <>
                  <strong className="truncate text-[15px]">{i.name}</strong>
                  <span className="truncate text-[13px] text-muted">{i.line}</span>
                </>
              );
              return (
                <li key={i.id}>
                  {i.href ? (
                    <Link href={i.href} className="flex flex-col gap-0.5 rounded-2xl px-3 py-2.5 text-text no-underline hover:bg-soft">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex flex-col gap-0.5 rounded-2xl px-3 py-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Link href={more.href} className="inline-flex min-h-11 w-fit items-center gap-1 px-1 text-[14px] font-semibold">
          {more.label} <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </ExpandCard>
  );
}
