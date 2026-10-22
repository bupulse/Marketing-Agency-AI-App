// A campaign's pay rules and platforms in plain words for creators, on the public application page (/c/<slug>) and
// the creator's portal (docs/CREATOR_CAMPAIGNS.md). Pure. Built on the company side's words (company-forms.ts), with
// what a creator also needs to know: the view targets and the month's budget. Amounts are whole units ("2,000 RWF").

import { formatAmount, payRulesInWords, PLATFORM_LABEL, PLATFORMS, type Platform } from "./company-forms";
import type { PayRules, PeriodGoals } from "./pay";
import type { CreatorRequirements } from "./requirements";
import { POST_FORMATS } from "./wizard";

export const CREATOR_NETWORKS = PLATFORMS;
export type CreatorNetwork = Platform;
export const isCreatorNetwork = (v: unknown): v is CreatorNetwork => typeof v === "string" && (CREATOR_NETWORKS as readonly string[]).includes(v);

export const NETWORK_LABEL = PLATFORM_LABEL;
/** What a creator connects on each network (owner decision: professional Instagram, Facebook Pages). */
export const NETWORK_ACCOUNT: Record<CreatorNetwork, string> = { instagram: "Instagram professional account (Creator or Business)", facebook: "Facebook Page", tiktok: "TikTok account" };

export const networkLabel = (n: string) => (isCreatorNetwork(n) ? NETWORK_LABEL[n] : n);

export const amount = formatAmount;
export const count = (n: number) => Math.floor(n).toLocaleString("en-US");

/** "Instagram, TikTok and Facebook". */
export function listWords(items: string[], last = "and"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${last} ${items[items.length - 1]}`;
}

/**
 * The pay rules as a creator reads them, e.g. "2,000 RWF for every 1,000 views, up to 50,000 views a month": the
 * company's words (payRulesInWords) with the month's goals added. "A month" is one 30-day pay period.
 */
export function creatorPayInWords(rules: PayRules, goals: PeriodGoals, currency: string): string[] {
  const lines = payRulesInWords(rules, currency);
  const target = goals.viewTargetPerCreator && goals.viewTargetPerCreator > 0 ? goals.viewTargetPerCreator : null;
  if (target) {
    if (rules.ratePerThousand) lines[0] = `${lines[0]}, up to ${count(target)} views a month`;
    else lines.unshift(`Views count up to ${count(target)} a month`);
  }
  if (goals.viewTargetCampaign && goals.viewTargetCampaign > 0) {
    lines.push(`When all creators together pass ${count(goals.viewTargetCampaign)} views in a month, everyone's views are counted by the same share`);
  }
  if (goals.budget && goals.budget > 0) lines.push(`The month's budget is ${amount(goals.budget, currency)}: if creators together earn more, everyone's pay goes down by the same share`);
  return lines;
}

/** "1 video a day, on each of Instagram and TikTok" (ALL) or "2 posts a day, on Instagram or TikTok" (ANY). */
export function taskRuleInWords(task: { postsPerDay: number; platforms: string[]; platformMode: string; mediaKind: string }): string {
  const kind = task.mediaKind === "VIDEO" ? "video" : task.mediaKind === "IMAGE" ? "photo post" : "post";
  const what = task.postsPerDay === 1 ? `1 ${kind}` : `${task.postsPerDay} ${kind}s`;
  const names = task.platforms.map(networkLabel);
  const where = names.length <= 1 ? `on ${names[0] ?? "your account"}` : task.platformMode === "ALL" ? `on each of ${listWords(names)}` : `on ${listWords(names, "or")}`;
  return `${what} a day, ${where}`;
}

/** "21 October 2026" for a "YYYY-MM-DD" day. */
export function formatDay(ymd: string, withYear = true): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}

/** "21 October – 19 November 2026" (the year once when both days share it). */
export function formatSpan(from: string, to: string): string {
  if (from === to) return formatDay(from);
  return from.slice(0, 4) === to.slice(0, 4) ? `${formatDay(from, false)} – ${formatDay(to)}` : `${formatDay(from)} – ${formatDay(to)}`;
}

/** Who a campaign looks for, short, for cards and its page: "Kigali · 1,000+ followers · Kinyarwanda · Food and drinks". */
export function requirementsInWords(req: CreatorRequirements): string[] {
  const out: string[] = [];
  if (req.locations.length) out.push(listWords(req.locations, "or"));
  if (req.minFollowers) out.push(`${count(req.minFollowers)}+ followers`);
  if (req.languages.length) out.push(listWords(req.languages, "or"));
  if (req.niches.length) out.push(req.niches.length > 2 ? `${req.niches.slice(0, 2).join(", ")} and more` : listWords(req.niches));
  return out;
}

/** "Reel / short video, Story" for a campaign's formats (unknown ones left out). */
export function formatsInWords(formats: string[]): string[] {
  return formats.flatMap((f) => POST_FORMATS.find((p) => p.value === f)?.label ?? []);
}
