// What the owner does with the plan: save settings, approve, remove, regenerate. Every function
// starts from the signed-in user's id and only touches that user's business.
import "server-only";
import { prisma } from "@/lib/db";
import { industryContext } from "@/lib/industry-context";
import { profileContext } from "@/lib/knowledge/context";
import { writerKnowledge } from "@/lib/knowledge/writer-context";
import { writingSubject, type Subject } from "@/lib/knowledge/service";
import { getTextProvider } from "@/lib/ai";
import { withLedger } from "@/lib/ai/ledger";
import { AIBudgetExceededError, CompanyBudgetExceededError } from "@/lib/ai/budget";
import { ServiceDisabledError } from "@/lib/admin/switch";
import { readKnowledge } from "@/lib/brand/schemas";
import { knowledgeFacts } from "@/lib/business-info/facts";
import { logError } from "@/lib/errors";
import { approvePosts } from "@/lib/publishing/service";
import { isNetwork } from "@/lib/social/registry";
import type { Network } from "@/lib/social/types";
import { configuredModel } from "@/lib/studio/service";
import { consumeUsage, refundUsage, UsageLimitError } from "@/lib/usage";
import { holidaysBetween } from "./calendar";
import { getIdea, type AutopilotFormat } from "./playbook";
import { settingsSchema, toRow, type SettingsInput } from "./settings";
import { localDateISO, safeZone } from "./timezone";
import { writeGroup, type WriterBrand } from "./writer";

export type ManageResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Posts the owner can still change: not yet on the network. */
const CHANGEABLE = ["PENDING_APPROVAL", "SCHEDULED", "DRAFT"] as const;

async function businessOf(userId: string) {
  return prisma.business.findUnique({ where: { userId }, include: { industryRef: true } });
}

export async function saveSettings(userId: string, input: SettingsInput): Promise<ManageResult> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the settings and try again." };
  const business = await businessOf(userId);
  if (!business) return { ok: false, error: "We could not find your business." };

  // Only this business's own social accounts can be chosen.
  const owned = await prisma.connection.findMany({
    where: { businessId: business.id, kind: "SOCIAL", id: { in: parsed.data.connectionIds } },
    select: { id: true, provider: true },
  });
  const connectionIds = owned.filter((c) => isNetwork(c.provider)).map((c) => c.id);
  if (parsed.data.enabled && connectionIds.length === 0) {
    return { ok: false, error: "Pick at least one account for Autopilot to write for." };
  }
  const row = toRow({ ...parsed.data, connectionIds });
  await prisma.autopilotSettings.upsert({ where: { businessId: business.id }, create: { businessId: business.id, ...row }, update: row });
  return { ok: true };
}

/** Approves every Autopilot post of the owner that waits for approval. */
export async function approveAll(userId: string): Promise<ManageResult<{ approved: number }>> {
  const business = await businessOf(userId);
  if (!business) return { ok: false, error: "We could not find your business." };
  const pending = await prisma.post.findMany({
    where: { businessId: business.id, source: "AUTOPILOT", status: "PENDING_APPROVAL" },
    select: { id: true },
    take: 200,
  });
  const { approved } = await approvePosts(business.id, pending.map((p) => p.id));
  return { ok: true, approved };
}

/** Removes every post of one planned idea (all its accounts). */
export async function removeGroup(userId: string, groupId: string): Promise<ManageResult<{ removed: number }>> {
  const { count } = await prisma.post.deleteMany({
    where: { groupId, source: "AUTOPILOT", status: { in: [...CHANGEABLE] }, business: { userId } },
  });
  return count > 0 ? { ok: true, removed: count } : { ok: false, error: "That post is already gone or can no longer be changed." };
}

/** Asks for a new take on one planned idea: 1 text credit, given back if it fails. */
export async function regenerateGroup(userId: string, groupId: string): Promise<ManageResult> {
  const business = await businessOf(userId);
  if (!business) return { ok: false, error: "We could not find your business." };
  const posts = await prisma.post.findMany({
    where: { groupId, businessId: business.id, source: "AUTOPILOT", status: { in: [...CHANGEABLE] } },
    select: { id: true, text: true, network: true, format: true, playbookId: true, scheduledAt: true, productId: true, campaignId: true },
  });
  const idea = getIdea(posts[0]?.playbookId);
  if (posts.length === 0 || !idea) return { ok: false, error: "That post can no longer be regenerated." };

  let reservation: { periodStart: Date };
  try {
    reservation = await consumeUsage(userId, "text");
  } catch (error) {
    if (error instanceof UsageLimitError) return { ok: false, error: "You have no text credits left. Choose a plan or wait for your credits to renew." };
    throw error;
  }

  try {
    const knowledge = readKnowledge(business.knowledge);
    const tz = safeZone(business.timezone);
    const first = posts[0];
    const day = first.scheduledAt ? localDateISO(first.scheduledAt, tz) : localDateISO(new Date(), tz);
    const holiday = idea.needs.includes("holiday") ? holidaysBetween(business.country, day, day).find((h) => !h.sensitive) : undefined;
    const faqs = idea.needs.includes("faq") ? await prisma.knowledgeFaq.findMany({ where: { businessId: business.id }, orderBy: { position: "asc" }, take: 50, select: { question: true, answer: true } }) : [];
    const faq = idea.needs.includes("faq")
      ? faqs.sort((a, b) => overlap(first.text, `${b.question} ${b.answer}`) - overlap(first.text, `${a.question} ${a.answer}`))[0]
      : undefined;
    const subject: Subject | null = first.productId ? { kind: "product", id: first.productId } : first.campaignId ? { kind: "campaign", id: first.campaignId } : null;
    const about = subject ? await writingSubject(business.id, subject) : null;
    const brand: WriterBrand = {
      businessName: business.name,
      industry: business.industry,
      industryContext: industryContext(business),
      profile: profileContext(business.profile),
      ...(await writerKnowledge(business.id)),
      description: business.description,
      audience: business.audience,
      tone: business.tone,
      website: business.website,
      contentLanguage: business.contentLanguage,
      knowledge: knowledgeFacts(knowledge),
      ownerName: business.ceoName,
      country: business.country,
    };
    const targets = [...new Map(posts.filter((p) => isNetwork(p.network)).map((p) => [p.network, p.format as AutopilotFormat])).entries()].map(([network, format]) => ({ network: network as Network, format }));
    const configured = (process.env.AI_TEXT_PROVIDER ?? "gemini").toLowerCase();
    const written = await withLedger(
      { userId, businessId: business.id, feature: "autopilot" },
      { provider: configured, model: configuredModel(configured) },
      () =>
        writeGroup(getTextProvider(), {
          brand,
          idea,
          facts: {
            project: about ? { type: about.type, title: about.title, price: about.price, features: about.features, context: about.context } : undefined,
            faq,
            holiday: holiday && { name: holiday.name, date: holiday.date },
            date: day,
          },
          targets,
          previousText: first.text,
          instruction: "Write a clearly different take.",
        }),
      (r) => ({ provider: r.provider, model: r.model, usage: r.usage }),
    );
    for (const post of posts) {
      const version = written.versions.find((v) => v.network === post.network);
      if (!version) continue;
      await prisma.post.updateMany({
        where: { id: post.id, businessId: business.id, status: { in: [...CHANGEABLE] } },
        data: { text: version.text, hashtags: version.hashtags, title: version.title },
      });
    }
    return { ok: true };
  } catch (error) {
    await refundUsage(userId, "text", reservation.periodStart).catch((e) => logError(e, { source: "autopilot.refund", userId }));
    if (error instanceof CompanyBudgetExceededError) return { ok: false, error: `${error.message} Your credit was returned.` };
    if (error instanceof AIBudgetExceededError || error instanceof ServiceDisabledError) return { ok: false, error: "Autopilot is paused for a short while. Please try again later." };
    await logError(error, { source: "autopilot.regenerate", userId, businessId: business.id });
    return { ok: false, error: "We could not write a new version. Your credit was returned. Please try again." };
  }
}

/** How many words two texts share, to match a post back to the FAQ it was written from. */
function overlap(a: string, b: string): number {
  const words = new Set(a.toLowerCase().match(/[\p{L}]{4,}/gu) ?? []);
  return (b.toLowerCase().match(/[\p{L}]{4,}/gu) ?? []).filter((w) => words.has(w)).length;
}
