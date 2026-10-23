import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { scheduleJob } from "@/lib/jobs/due";
import { RateLimitError, rateLimit } from "@/lib/rate-limit";
import { generateReply, type AiReply } from "./ai";
import type { DepartmentKey, Surface } from "./contract";
import { accountFacts, factsContext, pricingContext } from "./facts";
import { ensureGuideIndexed, guideMap, searchGuide } from "./guide";
import { handOver, handoverText } from "./handover";
import { HISTORY_FOR_AI, JUDGE_AFTER_MS, SUPPORT_LIMITS } from "./limits";
import { broadcast } from "./realtime";
import { decideHandover, leadScore, mergeTags, soundsUpset, urgencyOf } from "./rules";
import { getSupportSettings, teamHours, type SupportSettings } from "./settings";

// The AI's turn after a visitor message (docs/SUPPORT_CHAT.md section 2): search the guide, add the plans and the
// client's own account facts, answer in the visitor's language, then decide whether a person takes over (rules.ts).
// Only while the AI holds the chat (status AI); once handed over or taken over it stays quiet.

export const JOB_JUDGE = "support.judge";

/** Pages an AI button may open. Guide pages are added from the index. */
const BASE_PAGES = ["/pricing", "/signup", "/login", "/creators", "/contact", "/dashboard", "/dashboard/connections", "/dashboard/billing", "/dashboard/knowledge", "/dashboard/calendar"];

function hoursLine(settings: SupportSettings, now: Date, hasEmail: boolean): string {
  const hours = teamHours(settings, now);
  const whatsapp = settings.whatsapp ? " or WhatsApp" : "";
  if (hours.open) return `The team is online now (${hours.label}). If you hand over, say a person will join this chat shortly.`;
  return `The team is away now (${hours.label}). If you hand over, say when the team is back and that they will reply here and by email${whatsapp}${hasEmail ? "" : "; ask for their email address so the team can reply"}.`;
}

type HistoryRow = { author: string; kind: string; body: string; attachment: { transcript: string | null } | null };

export function historyFor(rows: HistoryRow[]): { from: "visitor" | "assistant" | "agent"; text: string }[] {
  return rows
    .filter((m) => m.author !== "SYSTEM" && m.kind !== "NOTE" && m.kind !== "EVENT")
    .map((m) => ({ from: m.author === "VISITOR" ? ("visitor" as const) : m.author === "AI" ? ("assistant" as const) : ("agent" as const), text: (m.attachment?.transcript ? `${m.body} (voice note: ${m.attachment.transcript})` : m.body).slice(0, 2000) }))
    .filter((m) => m.text.trim());
}

async function aiAllowed(ipHash: string): Promise<boolean> {
  try {
    await rateLimit(`support:ai:all`, SUPPORT_LIMITS.aiAll);
    await rateLimit(`support:ai:ip:${ipHash}`, SUPPORT_LIMITS.aiPerIpDay);
    return true;
  } catch (error) {
    if (error instanceof RateLimitError) return false;
    throw error;
  }
}

/** Answers the visitor's latest message, or hands the chat over. Never throws for an AI problem: that hands over. */
export async function answerVisitor(conversationId: string, ctx: { ipHash: string }, now = new Date()): Promise<void> {
  const c = await prisma.supportConversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true, status: true, aiActive: true, surface: true, tags: true, language: true, departmentId: true,
      visitor: { select: { userId: true, name: true, email: true, phone: true, businessName: true, businessId: true } },
      visit: { select: { country: true } },
    },
  });
  if (!c || c.status !== "AI" || !c.aiActive) return;
  const settings = await getSupportSettings();
  const surface = c.surface as Surface;
  const rows = await prisma.supportMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: HISTORY_FOR_AI, select: { author: true, kind: true, body: true, attachment: { select: { transcript: true } } } });
  const history = historyFor(rows.reverse());
  const visitorTexts = history.filter((h) => h.from === "visitor").map((h) => h.text);
  const lastText = visitorTexts[visitorTexts.length - 1] ?? "";

  let ai: AiReply | null = null;
  let guide: Awaited<ReturnType<typeof searchGuide>> = [];
  let planStatus: string | null = null;
  if (settings.aiEnabled && lastText && (await aiAllowed(ctx.ipHash))) {
    try {
      await ensureGuideIndexed();
      const facts = surface === "dashboard" && c.visitor.businessId ? await accountFacts(c.visitor.businessId, now) : null;
      planStatus = facts?.planStatus ?? null;
      const [hits, map, pricing] = await Promise.all([
        searchGuide(visitorTexts.slice(-2).join(" "), 4),
        guideMap(),
        surface === "creator" ? Promise.resolve(null) : pricingContext(c.visit?.country ?? null).catch(() => null),
      ]);
      guide = hits;
      const allowedPages = [...new Set([...BASE_PAGES, ...map.flatMap((m) => (m.page ? [m.page] : []))])];
      ai = await generateReply(
        {
          surface,
          history,
          guide,
          guideMap: map,
          pricing,
          account: facts ? factsContext(facts) : null,
          hoursLine: hoursLine(settings, now, !!c.visitor.email),
          aiRules: settings.aiRules,
          handoverTopics: settings.handoverTopics,
          allowedPages,
          visitorName: c.visitor.name,
        },
        c.visitor.userId,
      );
    } catch (error) {
      await logError(error, { source: "support.ai", level: "warn" });
      ai = null;
    }
  }

  const decision = decideHandover({ surface, text: lastText, topics: settings.handoverTopics, ai: ai && { handover: ai.handover, confident: ai.confident, sales: ai.sales } });
  const upset = decision.reason === "upset" || soundsUpset(lastText);
  const language = ai?.language ?? c.language;
  const score = leadScore({
    surface,
    planStatus,
    hasEmail: !!c.visitor.email,
    hasPhone: !!c.visitor.phone,
    hasBusiness: !!c.visitor.businessName,
    visitorMessages: visitorTexts.length,
    sales: decision.salesTag || !!ai?.sales,
    signal: ai?.leadSignal ?? "none",
  });
  const tags = mergeTags(c.tags, { score, note: ai?.note || null, upset, sales: decision.salesTag, outsideHours: false, topics: ai?.topics ?? [] });

  const created = ai
    ? await prisma.supportMessage.create({
        data: {
          conversationId,
          author: "AI",
          kind: "TEXT",
          body: ai.reply,
          lang: ai.language,
          aiConfident: ai.confident,
          aiSources: ai.sources.map((n) => guide[n - 1]).map((g) => ({ id: g.id, title: `${g.title}: ${g.heading}`, heading: g.heading, href: g.page })) as Prisma.InputJsonValue,
          aiActions: ai.actions.length ? (ai.actions as Prisma.InputJsonValue) : undefined,
        },
        select: { id: true },
      })
    : decision.reason
      ? await prisma.supportMessage.create({ data: { conversationId, author: "SYSTEM", kind: "TEXT", body: handoverText(language, teamHours(settings, now)), lang: language }, select: { id: true } })
      : null;
  await prisma.supportConversation.update({
    where: { id: conversationId },
    data: {
      language,
      leadScore: score,
      urgency: urgencyOf(upset, ai?.urgency ?? "none"),
      tags,
      lastMessageAt: new Date(),
      ...(ai ? { aiReplyCount: { increment: 1 } } : {}),
    },
  });
  if (created) await broadcast({ type: "message.created", conversationId, messageId: created.id }, { visitor: conversationId, inbox: true, conversation: conversationId });

  if (decision.reason) {
    await handOver(conversationId, decision.reason, { department: (ai?.department as DepartmentKey | undefined) ?? (decision.salesTag ? "sales" : null), now });
  } else {
    // The judge looks again 2 hours after the last message (each new message moves it).
    await scheduleJob({ kind: JOB_JUDGE, runAt: new Date(now.getTime() + JUDGE_AFTER_MS), payload: { conversationId }, dedupeKey: `${JOB_JUDGE}:${conversationId}` });
  }
}
