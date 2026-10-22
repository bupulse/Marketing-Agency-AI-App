import "server-only";
import { prisma } from "@/lib/db";
import { isHexColor, PULSE_BLUE } from "@/lib/color-contrast";
import { campaignLimits, defaultCurrency, ensureCampaignFolders, type CampaignActor, type WizardCampaign } from "@/lib/creators/campaigns";
import { tiktokAuthConfig } from "@/lib/creators/connect-flow";
import { defaultForm } from "@/lib/creators/form-fields";
import { logoUrls } from "@/lib/creators/logos";
import { campaignNetworks } from "@/lib/creators/networks";
import { dayIn } from "@/lib/creators/periods";
import { readFiles, STEP_COUNT, type WizardStepId } from "@/lib/creators/wizard";
import { ideaExamplesFor, type WizardAnswers } from "@/lib/creators/wizard-steps";
import { handleMention } from "@/lib/creators/wizard-suggest";
import { CAMPAIGN_TYPE_LABEL } from "@/lib/knowledge/campaigns";
import { KIND_SHORT } from "@/lib/knowledge/products";
import { subjectOptions } from "@/lib/knowledge/service";
import { assetById, listMedia } from "@/lib/media/service";
import type { FolderView } from "./files-step";
import type { WizardOptions } from "./wizard";

type Business = { id: string; name: string; timezone: string; industry: string | null; instagramHandle: string | null; logoUrl: string | null; brandColors: string[] };

const FOLDER_KEYS = [
  ["images", "imagesFolderId"],
  ["videos", "videosFolderId"],
  ["documents", "documentsFolderId"],
] as const;

/**
 * What the wizard's steps need besides the answers, for the step on screen. On Files it makes the campaign's three
 * Photos folders first (once) and reads their first files; on Look and Review the cover.
 */
export async function wizardOptions(actor: CampaignActor, business: Business, campaign: WizardCampaign | null, step: WizardStepId): Promise<{ options: WizardOptions; files: WizardAnswers["files"] | null }> {
  const [lists, limits, logos] = await Promise.all([subjectOptions(business.id), campaignLimits(business.id), logoUrls([business.logoUrl])]);
  const colors = business.brandColors.filter(isHexColor);
  let folders: FolderView[] | null = null;
  let files = campaign?.answers.files ?? null;
  let counts = campaign?.counts ?? { images: 0, videos: 0, documents: 0 };
  if (campaign && step === "files") {
    const made = await ensureCampaignFolders(actor, campaign.id).catch(() => readFiles(campaign.answers.files));
    files = { ...campaign.answers.files, ...made };
    const ids = FOLDER_KEYS.map(([, field]) => made[field]).filter((v): v is string => Boolean(v));
    const names = new Map((ids.length ? await prisma.mediaFolder.findMany({ where: { businessId: business.id, id: { in: ids } }, select: { id: true, name: true } }) : []).map((r) => [r.id, r.name]));
    folders = [];
    for (const [key, field] of FOLDER_KEYS) {
      const id = made[field];
      if (!id || !names.has(id)) continue;
      const [page, count] = await Promise.all([listMedia(business.id, { folderId: id, take: 11 }), prisma.mediaAsset.count({ where: { businessId: business.id, folderId: id } })]);
      folders.push({ key, id, name: names.get(id)!, count, items: page.items.map((m) => ({ id: m.id, name: m.name, url: m.url, kind: m.kind, posterUrl: m.posterUrl, durationMs: m.durationMs })) });
    }
    const of = (key: FolderView["key"]) => folders?.find((f) => f.key === key)?.count ?? 0;
    counts = { images: of("images"), videos: of("videos"), documents: of("documents") };
  }
  const coverId = campaign?.answers.look.coverAssetId;
  const cover = coverId && (step === "look" || step === "review") ? await assetById(business.id, coverId) : null;
  const options: WizardOptions = {
    campaignId: campaign?.id ?? null,
    slug: campaign?.slug ?? null,
    status: campaign?.status ?? "DRAFT",
    editing: campaign ? campaign.setupStep === null : false,
    reached: campaign?.setupStep ?? (campaign ? STEP_COUNT : 1),
    today: dayIn(new Date(), business.timezone),
    creatorsPerCampaign: limits.creatorsPerCampaign,
    networks: campaignNetworks(Boolean(tiktokAuthConfig())),
    products: lists.products.map((p) => ({ id: p.id, label: p.name, hint: KIND_SHORT[p.kind as keyof typeof KIND_SHORT] })),
    knowledgeCampaigns: lists.campaigns.map((c) => ({ id: c.id, label: c.name, hint: CAMPAIGN_TYPE_LABEL[c.type as keyof typeof CAMPAIGN_TYPE_LABEL] })),
    ideaExamples: ideaExamplesFor(business.industry, lists.products.slice(0, 3).map((p) => p.name)),
    industry: business.industry,
    handle: handleMention(business.instagramHandle),
    brand: { name: business.name, logoUrl: business.logoUrl ? (logos.get(business.logoUrl) ?? null) : null, colors, accent: colors[0] ?? PULSE_BLUE },
    folders,
    counts,
    cover: cover ? { url: cover.url, kind: cover.kind, posterUrl: cover.posterUrl } : null,
    problems: campaign?.problems ?? [],
  };
  return { options, files };
}

/** The answers of a new campaign before step 1 is saved (a Business info campaign or product can start it). */
export async function blankAnswers(business: Business, start: { idea?: string; name?: string; kind?: WizardAnswers["kind"]; knowledgeCampaignId?: string | null; productIds?: string[] } = {}): Promise<WizardAnswers> {
  const today = dayIn(new Date(), business.timezone);
  return {
    idea: start.idea ?? "",
    name: start.name ?? "",
    kind: start.kind ?? null,
    knowledgeCampaignId: start.knowledgeCampaignId ?? null,
    productIds: start.productIds ?? [],
    goal: null,
    requirements: { niches: [], locations: [], languages: [] },
    platforms: [],
    platformMode: "ANY",
    formats: [],
    mentions: [],
    startsOn: today,
    endsOn: today,
    briefEvery: null,
    postsPerDay: 1,
    mediaKind: "VIDEO",
    brief: "",
    tasks: [],
    dos: [],
    donts: [],
    rules: null,
    currency: await defaultCurrency(business.id),
    payRules: {},
    viewTargetPerCreator: null,
    viewTargetCampaign: null,
    budget: null,
    applicationForm: defaultForm(),
    files: { exampleLinks: [] },
    look: {},
    listed: true,
    acceptingApplications: true,
  };
}
