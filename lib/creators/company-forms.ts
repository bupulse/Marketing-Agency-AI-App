// The company side of creator campaigns (docs/CREATOR_CAMPAIGNS.md): what the campaign, task and goal forms accept,
// and the plain words the dashboard shows. Pure (no server imports), so the forms check the same rules as the server
// (lib/creators/campaigns.ts) and the tests read them directly.

import { z } from "zod";
import { addDaysYmd } from "@/lib/demo/slots";
import { paysAnything, payRulesSchema, type PayRules, type PeriodPay } from "./pay";
import { daysInclusive, MAX_CAMPAIGN_DAYS } from "./periods";

export const PLATFORMS = ["instagram", "facebook", "tiktok"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABEL: Record<Platform, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok" };

export const CAMPAIGN_STATUSES = ["DRAFT", "LIVE", "PAUSED", "ENDED"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = { DRAFT: "Draft", LIVE: "Live", PAUSED: "Paused", ENDED: "Ended" };

export const CREATOR_STATUS_LABEL: Record<string, string> = { APPLIED: "Applied", SELECTED: "Invited", JOINED: "Joined", DECLINED: "Declined", REMOVED: "Removed" };
export const POST_STATUS_LABEL: Record<string, string> = { CHECKING: "Checking", TRACKING: "Counting views", INVALID: "Not valid", REMOVED: "Removed", REJECTED: "Rejected", FINAL: "Final" };

/** Days an invite link works (like team invites, but longer: creators may take a while to answer). */
export const CREATOR_INVITE_DAYS = 14;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const count = z.number().int().min(1, "Use a number above 0, or leave it empty.").max(1_000_000_000).nullable().optional();

/** "@handle", "#hashtag" or a link: the words a post's caption must contain (any one is enough). */
export function isMention(value: string): boolean {
  return /^@[\w.]{1,60}$/.test(value) || /^#[\p{L}\p{N}_]{1,80}$/u.test(value) || /^https?:\/\/\S{3,200}$/i.test(value);
}

/** The mentions typed in one box, split on commas, spaces or new lines, without repeats. */
export function mentionsFrom(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    const m = raw.trim();
    if (m && !seen.has(m.toLowerCase())) {
      seen.add(m.toLowerCase());
      out.push(m);
    }
  }
  return out;
}

export const questionSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(3, "Write each question in a few words.").max(200),
  required: z.boolean(),
});
export type CampaignQuestion = z.infer<typeof questionSchema>;

/** The company's own application questions as stored (Json): unreadable ones are left out. */
export function readQuestions(value: unknown): CampaignQuestion[] {
  const parsed = z.array(questionSchema).safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

export const campaignSchema = z
  .object({
    name: z.string().trim().min(2, "Give the campaign a name.").max(80, "Keep the name under 80 characters."),
    brief: z.string().trim().min(10, "Write a short brief: what the posts should show.").max(4000),
    rules: z.string().trim().max(4000).nullable().optional(),
    platforms: z.array(z.enum(PLATFORMS)).min(1, "Pick at least one platform.").max(PLATFORMS.length),
    startsOn: ymd,
    endsOn: ymd,
    mentions: z.array(z.string().trim().min(2).max(200)).max(10, "Use at most 10 mentions."),
    currency: z.string().trim().regex(/^[A-Z]{3}$/, "Pick a currency."),
    payRules: payRulesSchema,
    viewTargetPerCreator: count,
    viewTargetCampaign: count,
    /** The budget of each period, all creators together. */
    budget: count,
    questions: z.array(questionSchema).max(10, "Ask at most 10 questions."),
  })
  .superRefine((c, ctx) => {
    const days = daysInclusive(c.startsOn, c.endsOn);
    if (!(days >= 1)) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "The last day must be on or after the first day." });
    else if (days > MAX_CAMPAIGN_DAYS) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "A campaign can run for a year at most." });
    const bad = c.mentions.find((m) => !isMention(m));
    if (bad) ctx.addIssue({ code: "custom", path: ["mentions"], message: `"${bad}" is not a mention: use @yourhandle, #yourhashtag or a link.` });
    if (!paysAnything(c.payRules)) ctx.addIssue({ code: "custom", path: ["payRules"], message: "Set how creators earn: a rate per 1,000 views, a fee per post or a milestone." });
    const caps = c.payRules.milestones ?? [];
    if (new Set(caps.map((m) => m.views)).size !== caps.length) ctx.addIssue({ code: "custom", path: ["payRules"], message: "Two milestones have the same number of views." });
  });
export type CampaignInput = z.input<typeof campaignSchema>;
export type CampaignValues = z.output<typeof campaignSchema>;

export const TASK_MEDIA = ["VIDEO", "IMAGE", "ANY"] as const;
export const TASK_MEDIA_LABEL: Record<(typeof TASK_MEDIA)[number], string> = { VIDEO: "Video", IMAGE: "Photo", ANY: "Video or photo" };

export const taskSchema = z
  .object({
    title: z.string().trim().min(2, "Give the task a title.").max(120),
    instructions: z.string().trim().min(5, "Say what to post.").max(4000),
    startsOn: ymd,
    endsOn: ymd,
    postsPerDay: z.number().int().min(1, "At least 1 post a day.").max(10, "At most 10 posts a day."),
    platforms: z.array(z.enum(PLATFORMS)).min(1, "Pick at least one platform."),
    /** ALL: a post on every platform of the task. ANY: one post on any of them (owner decision). */
    platformMode: z.enum(["ALL", "ANY"]),
    mediaKind: z.enum(TASK_MEDIA),
  })
  .superRefine((t, ctx) => {
    if (!(daysInclusive(t.startsOn, t.endsOn) >= 1)) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "The last day must be on or after the first day." });
  });
export type TaskInput = z.input<typeof taskSchema>;

/** How a task is repeated over its span: one task, one per week, one per day (owner decision). */
export type TaskRepeat = "none" | "week" | "day";

/** The spans of the tasks to create over `startsOn`..`endsOn`: the whole span, 7-day weeks from its first day, or days. */
export function taskSpans(startsOn: string, endsOn: string, repeat: TaskRepeat): { startsOn: string; endsOn: string }[] {
  const days = daysInclusive(startsOn, endsOn);
  if (!(days >= 1)) return [];
  if (repeat === "none") return [{ startsOn, endsOn }];
  const step = repeat === "week" ? 7 : 1;
  const out: { startsOn: string; endsOn: string }[] = [];
  for (let first = 0; first < days && out.length < MAX_CAMPAIGN_DAYS; first += step) {
    out.push({ startsOn: addDaysYmd(startsOn, first), endsOn: addDaysYmd(startsOn, Math.min(first + step, days) - 1) });
  }
  return out;
}

export const goalsSchema = z.object({ viewTargetPerCreator: count, viewTargetCampaign: count, budget: count });
export type GoalsInput = z.input<typeof goalsSchema>;

/** The first problem of a failed parse, in words for the form. */
export function firstProblem(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form.";
}

/** Whole units of the campaign's currency: "12,500 RWF". */
export function formatAmount(amount: number, currency: string): string {
  return `${Math.floor(amount).toLocaleString("en-US")} ${currency}`;
}

/** The pay rules in plain words, one line each, for the campaign's pages. */
export function payRulesInWords(rules: PayRules, currency: string): string[] {
  const money = (n: number) => formatAmount(n, currency);
  const out: string[] = [];
  if (rules.ratePerThousand) out.push(`${money(rules.ratePerThousand)} for every 1,000 views`);
  for (const m of [...(rules.milestones ?? [])].sort((a, b) => a.views - b.views)) out.push(`${money(m.amount)} once, when a post reaches ${m.views.toLocaleString("en-US")} views`);
  if (rules.feePerPost) out.push(`${money(rules.feePerPost)} for every post handed in`);
  if (rules.capPerPost) out.push(`At most ${money(rules.capPerPost)} per post in a pay period`);
  if (rules.capPerCreator) out.push(`At most ${money(rules.capPerCreator)} per creator in a pay period`);
  return out;
}

const LIMIT_WORDS: Record<PeriodPay["limitsHit"][number], string> = {
  creatorTarget: "Some creators passed their view target: their views above it do not earn.",
  campaignTarget: "All creators together passed the campaign's view target: everyone's counted views were scaled down by the same share.",
  capPerPost: "Some posts reached the most one post can earn in a period.",
  capPerCreator: "Some creators reached the most one creator can earn in a period.",
  budget: "The period's budget is reached: everyone's pay was scaled down by the same share to fit it.",
};

/** Why pay was cut this period, in plain words (PeriodPay.limitsHit). */
export function limitsInWords(hit: PeriodPay["limitsHit"]): string[] {
  return hit.map((k) => LIMIT_WORDS[k]);
}

/** A wa.me link to a WhatsApp number (any format with its country code) with a message typed in. Null without a number. */
export function whatsappLink(phone: string | null | undefined, message: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** The short message sent with an invite link. */
export function inviteMessage(name: string, campaign: string, company: string, link: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return `Hi${first ? ` ${first}` : ""}, ${company} picked you for "${campaign}". Join here (the link works once, for ${CREATOR_INVITE_DAYS} days): ${link}`;
}
