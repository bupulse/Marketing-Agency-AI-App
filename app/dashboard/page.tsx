import { getAppContext } from "@/components/app/context";
import { createActions } from "@/components/app/nav";
import { HomeView, type HomeViewData } from "@/components/app/views/a-home-view";
import { EssentialsBanner } from "@/components/business-info/essentials-banner";
import { QuizCard } from "@/components/knowledge/quiz-card";
import { prisma } from "@/lib/db";
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
  const showQuiz = !!quiz && quiz.playable && !quiz.done;

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

  const meters = [
    { label: "Text generations", value: used.text, max: limits.text },
    { label: "AI image credits", value: used.image, max: limits.image },
    { label: "Videos", value: used.videos, max: limits.videos },
    { label: "Voice characters", value: used.voiceCharacters, max: limits.voiceCharacters },
  ];

  const data: HomeViewData = {
    firstName,
    businessName,
    logoUrl,
    swatches,
    voiceLabel,
    canEditBrand,
    checklist,
    counts: { products: productCount, content: contentCount, leads: leadCount, designs: designCount },
    recentProducts: recentProducts.map((p) => ({ id: p.id, name: p.name, line: `${KIND_LABEL[p.kind]} · ${formatPrice(p)}` })),
    recentLeads: recentLeads.map((l) => ({ id: l.id, name: l.name ?? l.email ?? "Visitor", line: `${l.interest ?? l.message ?? "New enquiry"} · ${timeAgo(l.createdAt)}` })),
    meters,
    planEnded,
    // The + Create actions as big cards (the Video Studio's new-tab link stays in the menu: here, the Videos page).
    actions: createActions(role, [...entitlements.inPlan], null),
  };

  return (
    <HomeView
      data={data}
      top={
        <>
          {showQuiz && quiz && (
            <QuizCard
              entry={quiz}
              title={quiz.overall === 0 ? "Tell BuPulse about your business: a 5-minute quiz" : "Finish your Business info: a 5-minute quiz"}
              text="Your posts, designs and chat replies get better the more BuPulse knows. One question at a time, mostly taps: BuPulse guesses, you confirm."
              note={`BuPulse knows your business ${quiz.overall}%.`}
            />
          )}
          {business?.onboardedAt && canEditBrand && <EssentialsBanner knowledge={business.knowledge} />}
        </>
      }
    />
  );
}
