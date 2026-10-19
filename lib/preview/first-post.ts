import "server-only";
// The free first-post preview (docs/guide/features/31-first-post-preview.md, docs/bizdev/PLAN.md): while a company waits
// for its demo it may ask BuPulse for one post about its business (caption, hashtags, an ad headline), so it sees the
// value before the call. Off until the owner switches it on in Admin -> Settings, because it spends AI money.
//
// Rules: the switch is on; the company waits for its demo (lib/entitlements.ts previewAllowed) and is not suspended
// (lib/usage.ts assertPreviewAllowed); one per company (FirstPostPreview's unique businessId), a failed one may be
// tried once more. The call goes through the cost ledger, the monthly cap and the company allowance like every AI call
// (withLedger, feature "first_post_preview"). It is not counted in the plan's usage: the trial starts after it.
import { getTextProvider } from "@/lib/ai";
import { withLedger } from "@/lib/ai/ledger";
import { generateMarketingContent } from "@/lib/ai/marketing";
import { resolvePrice } from "@/lib/ai/pricing";
import { getSetting } from "@/lib/admin/settings";
import { readKnowledge } from "@/lib/brand/schemas";
import { knowledgeFacts } from "@/lib/business-info/facts";
import { prisma } from "@/lib/db";
import { companyMayPreview } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { industryContext } from "@/lib/industry-context";
import { DEFAULT_GEMINI_TEXT_MODEL } from "@/lib/ai/gemini-text";
import { assertPreviewAllowed, UsageLimitError } from "@/lib/usage";

export const FIRST_POST_FEATURE = "first_post_preview";
/** A failed preview may be tried once more; then it is the demo's job. */
export const FIRST_POST_MAX_ATTEMPTS = 2;
/**
 * Tokens of one marketing-content call, for the cost shown next to the switch before any preview exists (an estimate:
 * the prompt with the business's facts and sector guidance, and the caption, hashtags, script and headlines it returns).
 * The ledger records the real tokens of every preview, and Settings shows their average once there are some.
 */
export const PREVIEW_TOKENS = { input: 2_500, output: 900 } as const;

export type PreviewStatus = "making" | "ready" | "failed";
export type PreviewView = { status: PreviewStatus; caption: string | null; hashtags: string[]; headline: string | null; canRetry: boolean };

export type PreviewErrorCode = "off" | "not_waiting" | "used" | "failed" | "busy";
export class PreviewError extends Error {
  constructor(
    public code: PreviewErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const OFF = "The free preview is not available right now. You will see your first post in the demo.";
const NOT_WAITING = "Your dashboard is open: make your posts from Content.";
const FAILED = "We could not make your post just now. Please try again in a moment.";

/** The estimated cost of one preview in USD with the prices in lib/ai/pricing.ts, or null for an unknown model. */
export function previewCostUsd(model: string, tokens: { input: number; output: number } = PREVIEW_TOKENS): number | null {
  const r = resolvePrice(model);
  if (!r) return null;
  return (tokens.input * r.price.input + tokens.output * r.price.output) / 1_000_000;
}

/** The model the configured text provider uses (as lib/studio/service.ts configuredModel), for the estimate and the ledger. */
const configuredModel = (provider: string) => (provider === "claude" ? (process.env.CLAUDE_TEXT_MODEL ?? "claude-opus-5-5") : (process.env.GEMINI_TEXT_MODEL ?? DEFAULT_GEMINI_TEXT_MODEL));

/** The model a preview runs on now, for the estimate. */
export function previewModel(): string {
  return configuredModel((process.env.AI_TEXT_PROVIDER ?? "gemini").toLowerCase());
}

/** Settings: the estimate per sign-up, and the real average of the previews made so far (ledger), when there are some. */
export async function previewCostSummary(): Promise<{ model: string; estimateUsd: number | null; made: number; averageUsd: number | null }> {
  const model = previewModel();
  const agg = await prisma.aiCall.aggregate({ where: { feature: FIRST_POST_FEATURE }, _avg: { costUsd: true }, _count: { _all: true } }).catch(() => null);
  const avg = agg?._avg.costUsd;
  return { model, estimateUsd: previewCostUsd(model), made: agg?._count._all ?? 0, averageUsd: avg == null ? null : Number(avg) };
}

type Row = { status: string; caption: string | null; hashtags: string[]; headline: string | null; attempts: number };
const view = (r: Row): PreviewView => ({ status: r.status as PreviewStatus, caption: r.caption, hashtags: r.hashtags, headline: r.headline, canRetry: r.status === "failed" && r.attempts < FIRST_POST_MAX_ATTEMPTS });

/** The company's preview, or null when it has none. */
export async function getFirstPostPreview(businessId: string): Promise<PreviewView | null> {
  const row = await prisma.firstPostPreview.findUnique({ where: { businessId } }).catch(() => null);
  return row ? view(row) : null;
}

/** Whether the demo screen offers the preview: the switch is on and the company waits for its demo. */
export async function previewOffered(businessId: string): Promise<boolean> {
  return (await getSetting("firstPostPreview")) && (await companyMayPreview(businessId));
}

const isUniqueError = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

/**
 * Takes the company's one preview: a new row, or a failed one tried again (conditional on its attempts, so two clicks
 * never make two calls). Null when another request holds it or it is used: the caller shows what is there.
 */
async function claim(userId: string, businessId: string): Promise<"claimed" | Row> {
  const existing = await prisma.firstPostPreview.findUnique({ where: { businessId } });
  if (!existing) {
    try {
      await prisma.firstPostPreview.create({ data: { businessId, userId, status: "making", attempts: 1, hashtags: [] } });
      return "claimed";
    } catch (e) {
      if (!isUniqueError(e)) throw e;
      return (await prisma.firstPostPreview.findUnique({ where: { businessId } }))!;
    }
  }
  if (existing.status !== "failed" || existing.attempts >= FIRST_POST_MAX_ATTEMPTS) return existing;
  const { count } = await prisma.firstPostPreview.updateMany({ where: { businessId, status: "failed", attempts: existing.attempts }, data: { status: "making", attempts: existing.attempts + 1, error: null } });
  return count === 1 ? "claimed" : (await prisma.firstPostPreview.findUnique({ where: { businessId } }))!;
}

/**
 * Makes the company's first-post preview (one AI call), or returns the one it already has. `userId` is the company
 * account (SessionUser.id). Throws PreviewError with a message for the client.
 */
export async function makeFirstPostPreview(input: { userId: string; businessId: string }): Promise<PreviewView> {
  const { userId, businessId } = input;
  if (!(await getSetting("firstPostPreview"))) throw new PreviewError("off", OFF);
  if (!(await companyMayPreview(businessId))) throw new PreviewError("not_waiting", NOT_WAITING);
  try {
    await assertPreviewAllowed(userId);
  } catch (e) {
    if (e instanceof UsageLimitError) throw new PreviewError("not_waiting", NOT_WAITING);
    throw e;
  }
  const claimed = await claim(userId, businessId);
  if (claimed !== "claimed") {
    if (claimed.status === "failed") throw new PreviewError("used", "Your free preview could not be made. We will make your first post together in the demo.");
    return view(claimed);
  }

  try {
    const business = await prisma.business.findUnique({ where: { id: businessId }, include: { industryRef: true } });
    if (!business) throw new Error("Business not found");
    const provider = (process.env.AI_TEXT_PROVIDER ?? "gemini").toLowerCase();
    const result = await withLedger(
      { userId, businessId, feature: FIRST_POST_FEATURE },
      { provider, model: configuredModel(provider) },
      () =>
        generateMarketingContent(
          getTextProvider(),
          {
            businessName: business.name,
            industry: business.industry,
            industryContext: industryContext(business),
            description: business.description ?? business.industryDescription,
            audience: business.audience,
            tone: business.tone,
            website: business.website,
            contentLanguage: business.contentLanguage,
            knowledge: knowledgeFacts(readKnowledge(business.knowledge)),
          },
          {
            type: "business",
            title: business.name,
            features: [],
            instruction: "This is the business's first post with BuPulse: introduce what it sells and why customers choose it, and invite them to get in touch.",
          },
        ),
      (r) => ({ provider: r.provider, model: r.model, usage: r.usage }),
    );
    const row = await prisma.firstPostPreview.update({
      where: { businessId },
      data: { status: "ready", caption: result.content.caption, hashtags: result.content.hashtags, headline: result.content.adHeadlines[0] ?? null, provider: result.provider, model: result.model, error: null },
    });
    return view(row);
  } catch (error) {
    await logError(error, { source: "preview.first_post", level: "warn", businessId });
    const row = await prisma.firstPostPreview
      .update({ where: { businessId }, data: { status: "failed", error: (error instanceof Error ? error.message : String(error)).slice(0, 300) } })
      .catch(() => null);
    throw new PreviewError(row && row.attempts < FIRST_POST_MAX_ATTEMPTS ? "failed" : "used", row && row.attempts < FIRST_POST_MAX_ATTEMPTS ? FAILED : "Your free preview could not be made. We will make your first post together in the demo.");
  }
}
