import { Lock } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { initialValues } from "@/components/brand-profile/initial";
import { BackLink } from "@/components/knowledge/back-link";
import { BusinessQuiz } from "@/components/knowledge/business-quiz";
import { readKnowledge } from "@/lib/brand/schemas";
import { prisma } from "@/lib/db";
import { industryFormValues } from "@/lib/industries/shared";
import { personaFormValues } from "@/lib/knowledge/audience";
import { readPositioning } from "@/lib/knowledge/competitors";
import { readMarketingProfile } from "@/lib/knowledge/interview";
import { readPolicies } from "@/lib/knowledge/policies";
import { profileFormValues } from "@/lib/knowledge/profile";
import { loadQuizContext } from "@/lib/knowledge/quiz-ai";
import { likelyKind, reasonIdeas, templateDraft } from "@/lib/knowledge/quiz-draft";
import { isQuizRound, QUIZ_ROUNDS, type QuizRoundId, type QuizStored } from "@/lib/knowledge/quiz-map";
import { listCompetitors, listFaqs, listPersonas } from "@/lib/knowledge/records";
import { defaultCurrency } from "@/lib/knowledge/service";
import { can } from "@/lib/team/roles";

export const metadata = { title: "Business info quiz" };

/**
 * The Business info quiz (docs/QUIZ_MODE.md, "A. Business info quiz"): the same questions as the section forms, one
 * per screen, saved through their own actions. A round the person's role or plan cannot edit is left out (and named
 * under the quiz), as its form page would refuse it. `?round=you` starts at a round.
 */
export default async function QuizPage({ searchParams }: { searchParams: Promise<{ round?: string }> }) {
  const { business, role, entitlements } = await getAppContext();
  const params = await searchParams;
  const settings = can(role, "settings");
  const content = can(role, "content");
  const writing = entitlements.usable.has("content");

  const access: Record<QuizRoundId, "ok" | "role" | "plan"> = {
    you: settings ? "ok" : "role",
    sell: !content ? "role" : writing ? "ok" : "plan",
    customers: !content ? "role" : writing ? "ok" : "plan",
    why: !content ? "role" : writing ? "ok" : "plan",
    rules: settings ? "ok" : "role",
    find: settings ? "ok" : "role",
    voice: !settings ? "role" : writing ? "ok" : "plan",
    love: !content ? "role" : writing ? "ok" : "plan",
  };
  const rounds = QUIZ_ROUNDS.filter((r) => access[r.id] === "ok").map((r) => r.id);
  const locked = QUIZ_ROUNDS.filter((r) => access[r.id] !== "ok").map((r) => ({ id: r.id, title: `${r.emoji} ${r.title}`, why: access[r.id] as "role" | "plan" }));

  if (!rounds.length) {
    return (
      <>
        <BackLink />
        <PageHeader title="Business info quiz" />
        <EmptyState icon={Lock} title="Nothing to fill in here" text="Your company's owner or admins fill in Business info, or it is not in your plan yet." />
      </>
    );
  }

  const on = new Set(rounds);
  const [sector, personas, competitors, faqs, products, currency, ctx] = await Promise.all([
    on.has("you") ? prisma.business.findUnique({ where: { id: business.id }, select: { industryId: true, industryOther: true, industryDescription: true, industryRef: { select: { slug: true } } } }) : null,
    on.has("customers") ? listPersonas(business.id) : [],
    on.has("why") ? listCompetitors(business.id) : [],
    on.has("rules") ? listFaqs(business.id) : [],
    on.has("sell") ? prisma.product.findMany({ where: { businessId: business.id }, select: { name: true }, take: 500 }) : [],
    defaultCurrency(business.id),
    loadQuizContext(business.id),
  ]);
  const knowledge = readKnowledge(business.knowledge);
  const marketing = readMarketingProfile(business.marketingProfile);

  const stored: QuizStored = {
    profile: on.has("you")
      ? profileFormValues({ name: business.name, website: business.website, description: business.description, profile: business.profile, knowledgeArea: knowledge.area }, industryFormValues(sector ?? {}))
      : null,
    products: products.map((p) => p.name),
    personas: personas.map((p) => ({ id: p.id, ...personaFormValues(p) })),
    competitors: competitors.map((c) => c.name),
    positioning: readPositioning(business.positioning),
    policies: readPolicies(business.policies),
    faqs: faqs.map((f) => f.question),
    brand: on.has("find") ? initialValues(business) : null,
    voice: marketing ? { voice: marketing.voice, do: marketing.do, dont: marketing.dont, samples: marketing.samples } : null,
    voiceAnswers: marketing?.answers ?? [],
  };
  const start = isQuizRound(params.round) && on.has(params.round) ? params.round : null;
  const postsHref = entitlements.usable.has("calendar") ? "/dashboard/content/general?create=1" : "/dashboard/content";

  return (
    <>
      <BackLink />
      <BusinessQuiz
        rounds={rounds}
        locked={locked}
        stored={stored}
        fallback={templateDraft(ctx)}
        likelyKind={likelyKind(ctx)}
        reasonIdeas={reasonIdeas(ctx)}
        currency={currency}
        country={business.country ?? ""}
        places={{ city: knowledge.area && knowledge.area.length <= 40 ? knowledge.area : "", country: business.country ?? "" }}
        canGrant={settings}
        startRound={start}
        cacheKey={`bp-quiz-draft:${business.id}`}
        postsHref={postsHref}
      />
    </>
  );
}
