import { ArrowRight, CircleCheck, Circle, Image as ImageIcon, Package, Palette, PenLine, Users } from "lucide-react";
import Link from "next/link";
import { getAppContext } from "@/components/app/context";
import { EssentialsBanner } from "@/components/business-info/essentials-banner";
import { QuizCard } from "@/components/knowledge/quiz-card";
import { Badge, GlassCard, Meter } from "@/components/ui";
import { prisma } from "@/lib/db";
import { cn } from "@/lib/cn";
import { isHexColor } from "@/lib/color-contrast";
import { formatPrice, KIND_LABEL } from "@/lib/knowledge/products";
import { quizEntry } from "@/lib/knowledge/quiz-entry";
import { homeChecklist } from "@/lib/home-checklist";
import { can } from "@/lib/team/roles";
import { widgetInstalled } from "@/lib/widget/seen";

export const metadata = { title: "Dashboard" };

function timeAgo(date: Date) {
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

export default async function DashboardPage() {
  const { business, usage, role, entitlements, firstName, logoUrl, brandColors, voiceLabel, businessName, isTrial } = await getAppContext();

  const businessId = business?.id;
  const chatInPlan = entitlements.inPlan.has("websiteChat");
  // Business info not finished: the quiz is the shortcut to finish it (docs/QUIZ_MODE.md). Worked out alongside the
  // counts below (one round of database trips, not two), and shared with the layout's banner (cached per request). A
  // failing score hides the card instead of breaking Home.
  const quizP = business ? quizEntry(business, role, entitlements.usable).catch(() => null) : null;
  const [productCount, contentCount, leadCount, connectionCount, designCount, recentProducts, recentLeads, widget, cloudflareInstalls] = businessId
    ? await Promise.all([
        prisma.product.count({ where: { businessId, status: { not: "ARCHIVED" } } }),
        prisma.generatedContent.count({ where: { businessId } }),
        prisma.lead.count({ where: { businessId } }),
        prisma.connection.count({ where: { businessId } }),
        prisma.design.count({ where: { businessId } }),
        prisma.product.findMany({ where: { businessId, status: { not: "ARCHIVED" } }, orderBy: { updatedAt: "desc" }, take: 3 }),
        prisma.lead.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 3 }),
        chatInPlan ? prisma.chatWidget.findUnique({ where: { businessId }, select: { lastSeenAt: true, lastSeenHost: true, allowedDomains: true } }) : null,
        chatInPlan ? prisma.cloudflareInstall.count({ where: { businessId } }) : 0,
      ])
    : [0, 0, 0, 0, 0, [], [], null, 0];

  const quiz = await quizP;
  const showQuiz = !!quiz && quiz.playable && quiz.overall < 100;

  const { used, limits } = usage;
  // A paid plan that ended (lib/entitlements.ts "inactive", refused by lib/usage.ts too): its old limits are not usable.
  const planEnded = !isTrial && entitlements.block === "inactive";
  const brandDone = Boolean(business?.onboardedAt);
  const swatches = brandColors.filter(isHexColor).slice(0, 5);

  const checklist = homeChecklist({
    role,
    inPlan: entitlements.inPlan,
    brandDone,
    connections: connectionCount,
    products: productCount,
    widgetInstalled: widgetInstalled({ widget, cloudflareInstalls }),
  });
  // Brand and business details belong to the owner and admins (lib/team/roles.ts).
  const canEditBrand = can(role, "settings");
  const doneCount = checklist.filter((c) => c.done).length;

  const stats = [
    { label: "Products & services", value: productCount, note: "What you sell", icon: Package },
    { label: "Content pieces", value: contentCount, note: "Captions, scripts and ads", icon: PenLine },
    { label: "Leads", value: leadCount, note: "From your chat widget", icon: Users },
    { label: "Designs", value: designCount, note: "Branded posts made", icon: ImageIcon },
  ];

  const meters = [
    { label: "Text generations", value: used.text, max: limits.text },
    { label: "Images", value: used.image, max: limits.image },
    { label: "Videos", value: used.videos, max: limits.videos },
    { label: "Voice characters", value: used.voiceCharacters, max: limits.voiceCharacters },
  ];

  return (
    <>
      <header className="flex flex-col gap-1 px-1">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-[30px]">
          Welcome, {firstName}
        </h1>
        <p className="text-[15px] text-muted">Here is how your marketing is doing.</p>
        <div
          aria-hidden
          className="mt-2 h-1 w-24 rounded-full"
          style={{ background: "linear-gradient(90deg, var(--brand-1), var(--brand-2))" }}
        />
      </header>

      {showQuiz && quiz && (
        <QuizCard
          entry={quiz}
          title={quiz.overall === 0 ? "Tell BuPulse about your business: a 5-minute quiz" : "Finish your Business info: a 5-minute quiz"}
          text="Your posts, designs and chat replies get better the more BuPulse knows. One question at a time, mostly taps: BuPulse guesses, you confirm."
          note={`BuPulse knows your business ${quiz.overall}%.`}
        />
      )}

      {business?.onboardedAt && canEditBrand && <EssentialsBanner knowledge={business.knowledge} />}

      <GlassCard as="section" aria-labelledby="yb" className="flex flex-wrap items-center gap-x-5 gap-y-3 p-4 sm:p-5">
        {logoUrl ? (
          // Signed Supabase URL: plain img, no remotePatterns needed.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={`${businessName} logo`} width={48} height={48} className="size-12 shrink-0 rounded-2xl bg-white object-contain p-1" />
        ) : (
          <span aria-hidden className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-soft text-muted">
            <Palette className="size-5" />
          </span>
        )}
        <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1.5">
          <h2 id="yb" className="truncate text-base font-semibold">Your brand</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {swatches.length > 0 ? (
              <ul aria-label="Brand colours" className="flex gap-1.5">
                {swatches.map((c) => (
                  <li key={c} title={c} className="size-6 rounded-full border border-line" style={{ background: c }}>
                    <span className="sr-only">{c}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-[13px] text-muted">No colours yet</span>
            )}
            <span className="text-[13px] text-muted">{voiceLabel ? `Voice: ${voiceLabel}` : "No voice chosen yet"}</span>
          </div>
        </div>
        {canEditBrand && (
          <Link href="/dashboard/brand" className="inline-flex min-h-11 items-center text-sm font-semibold">
            Edit brand
          </Link>
        )}
      </GlassCard>

      <section aria-label="Overview" className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        {stats.map(({ label, value, note, icon: Icon }) => (
          <GlassCard key={label} className="flex flex-col gap-1.5 rounded-card p-5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted">{label}</span>
              <Icon aria-hidden className="size-4 text-pulse-blue" />
            </div>
            <strong className="text-[32px] font-semibold leading-none tracking-[-0.03em]">{value}</strong>
            <span className="text-xs text-muted">{note}</span>
          </GlassCard>
        ))}
      </section>

      <GlassCard as="section" aria-labelledby="getstarted" className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="getstarted" className="text-lg font-semibold">Get started</h2>
          <Badge tone={doneCount === checklist.length ? "success" : "blue"}>
            {doneCount} of {checklist.length} done
          </Badge>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {checklist.map(({ label, done, href, ask }) => {
            const body = (
              <>
                {done ? (
                  <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />
                ) : (
                  <Circle aria-hidden className="size-5 shrink-0 text-muted" />
                )}
                <span className="flex flex-1 flex-col">
                  <span className={cn("text-[15px] font-medium", done && "text-muted line-through")}>{label}</span>
                  {ask && !done && <span className="text-[13px] text-muted">{ask}</span>}
                </span>
                <span className="sr-only">{done ? "Done" : "Not done yet"}</span>
              </>
            );
            return (
              <li key={label}>
                {/* A step this role cannot open is shown read-only, with who to ask. */}
                {ask ? (
                  <div className="flex min-h-12 items-center gap-3 rounded-2xl px-3.5 py-2">{body}</div>
                ) : (
                  <Link href={href} className="flex min-h-12 items-center gap-3 rounded-2xl px-3.5 py-2 no-underline hover:bg-soft">
                    {body}
                    <ArrowRight aria-hidden className="size-4 shrink-0 text-muted" />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </GlassCard>

      <div className="flex flex-wrap gap-5">
        <GlassCard as="section" aria-labelledby="rp" className="min-w-0 flex-[1.5_1_340px] p-5 sm:p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="rp" className="text-lg font-semibold">Products & services</h2>
            <Link href="/dashboard/knowledge/products" className="inline-flex min-h-11 items-center px-1 text-sm font-semibold">View all</Link>
          </div>
          {recentProducts.length === 0 ? (
            <p className="rounded-2xl bg-soft px-4 py-8 text-center text-[15px] text-muted">
              Nothing here yet. Add what you sell in the <Link href="/dashboard/knowledge" className="font-semibold">Business info</Link>: products, services, events and offers.
            </p>
          ) : (
            <ul className="flex flex-col">
              {recentProducts.map((p) => (
                <li key={p.id}>
                  <Link href={`/dashboard/knowledge/products/${p.id}`} className="flex items-center gap-3.5 rounded-2xl p-3 no-underline hover:bg-soft">
                    <span aria-hidden className="size-12 shrink-0 rounded-[14px] bg-brand-gradient" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <strong className="truncate text-[15px]">{p.name}</strong>
                      <span className="truncate text-[13px] text-muted">
                        {KIND_LABEL[p.kind]} · {formatPrice(p)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>

        <GlassCard as="section" aria-labelledby="ld" className="min-w-0 flex-[1_1_280px] p-5 sm:p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="ld" className="text-lg font-semibold">New leads</h2>
            <Link href="/dashboard/leads" className="inline-flex min-h-11 items-center px-1 text-sm font-semibold">All leads</Link>
          </div>
          {recentLeads.length === 0 ? (
            <p className="rounded-2xl bg-soft px-4 py-8 text-center text-[15px] text-muted">
              No leads yet. They will show up here once visitors chat with your website widget.
            </p>
          ) : (
            <ul className="flex flex-col">
              {recentLeads.map((l) => (
                <li key={l.id} className="flex flex-col gap-0.5 rounded-2xl p-3 hover:bg-soft">
                  <strong className="truncate text-[15px]">{l.name ?? l.email ?? "Visitor"}</strong>
                  <span className="truncate text-[13px] text-muted">
                    {l.interest ?? l.message ?? "New enquiry"} · {timeAgo(l.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      </div>

      <GlassCard as="section" aria-labelledby="us" className="p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="us" className="text-lg font-semibold">Usage this period</h2>
          <Link href="/dashboard/usage" className="inline-flex min-h-11 items-center px-1 text-sm font-semibold">Details</Link>
        </div>
        {planEnded && <p className="-mt-2 mb-4 text-sm text-muted">Your plan has ended, so nothing new can be made until a plan is chosen. Everything you made is saved.</p>}
        <div className={cn("grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-5", planEnded && "opacity-60")}>
          {meters.map((m) => {
            const unavailable = m.max === 0;
            return (
              <div key={m.label} className={cn("flex flex-col gap-2", unavailable && "opacity-60")}>
                <div className="flex justify-between text-sm">
                  <span>{m.label}</span>
                  <span className="text-muted">{unavailable ? "Not in plan" : `${m.value} / ${m.max}`}</span>
                </div>
                <Meter value={m.value} max={m.max} label={m.label} />
              </div>
            );
          })}
        </div>
      </GlassCard>
    </>
  );
}
