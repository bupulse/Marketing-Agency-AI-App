// Who a campaign is looking for, and whether an applicant fits (docs/CREATOR_CAMPAIGN_WIZARD.md, "Creators"). Pure.
//
// Owner decision (22 October 2026): requirements never block an application. A creator who does not fit can still
// apply; the company sees "Doesn't match" and why, and the ones who match first.

import { z } from "zod";

export const NICHES = ["Food and drinks", "Fashion", "Beauty", "Tech", "Lifestyle", "Comedy", "Music", "Sports and fitness", "Travel", "Family and kids", "Business and money", "Education", "Health", "Cars", "Gaming", "Art and design", "Faith", "Farming"] as const;
export const LANGUAGES = ["Kinyarwanda", "English", "French", "Swahili"] as const;

/** The follower steps the slider stops at. */
export const FOLLOWER_STEPS = [0, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000] as const;

export const requirementsSchema = z.object({
  niches: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  /** Districts or cities, typed with the place search ("Kigali", "Musanze"). Empty: anywhere. */
  locations: z.array(z.string().trim().min(2).max(80)).max(20).default([]),
  languages: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  /** Followers on at least one of their accounts. */
  minFollowers: z.number().int().min(0).max(1_000_000_000).nullish(),
  /** How many creators the company wants (at most the plan's creatorsPerCampaign). */
  creatorsWanted: z.number().int().min(1).max(10_000).nullish(),
});
export type CreatorRequirements = z.infer<typeof requirementsSchema>;

export function readRequirements(value: unknown): CreatorRequirements {
  const parsed = requirementsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : { niches: [], locations: [], languages: [] };
}

/** What is known about an applicant: their accounts' followers, and the answers to the location, languages and niches presets. */
export type ApplicantFacts = { followers: number[]; location?: string | null; languages?: string[] | null; niches?: string[] | null };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const overlaps = (want: string[], have: string[]) => want.some((w) => have.some((h) => same(w, h)));

/**
 * Why an applicant does not fit, one line each (empty: they match), and what they did not say. Unknown facts are not
 * misses: a creator who skipped the location question shows "Location not given", not "Doesn't match".
 */
export function matchApplicant(req: CreatorRequirements, facts: ApplicantFacts): { misses: string[]; unknown: string[] } {
  const misses: string[] = [];
  const unknown: string[] = [];
  if (req.minFollowers) {
    const best = Math.max(0, ...facts.followers);
    if (facts.followers.length === 0) unknown.push("Followers not given");
    else if (best < req.minFollowers) misses.push(`Fewer than ${req.minFollowers.toLocaleString("en-US")} followers`);
  }
  if (req.locations.length) {
    const where = facts.location?.trim();
    if (!where) unknown.push("Location not given");
    else if (!req.locations.some((l) => where.toLowerCase().includes(l.trim().toLowerCase()) || l.toLowerCase().includes(where.toLowerCase()))) misses.push(`Not in ${req.locations.join(" or ")}`);
  }
  if (req.languages.length) {
    if (!facts.languages?.length) unknown.push("Languages not given");
    else if (!overlaps(req.languages, facts.languages)) misses.push(`Doesn't post in ${req.languages.join(" or ")}`);
  }
  if (req.niches.length) {
    if (!facts.niches?.length) unknown.push("Topics not given");
    else if (!overlaps(req.niches, facts.niches)) misses.push(`Doesn't post about ${req.niches.join(" or ")}`);
  }
  return { misses, unknown };
}
