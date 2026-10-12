// Competitors & what makes you different (Knowledge base). Pure, shared by the forms, the actions, the AI context and
// the tests.
//
// Storage: one Competitor row per competitor (ordered by `position`); the differentiators and the positioning
// statement in Business.positioning (JSON, read leniently with readPositioning).

import { z } from "zod";
import { chips, optional } from "./profile";

export const PRICE_POSITIONS = ["lower", "similar", "higher", "varies"] as const;
export type PricePosition = (typeof PRICE_POSITIONS)[number];
export const PRICE_POSITION_LABEL: Record<PricePosition, string> = {
  lower: "Cheaper than us",
  similar: "About the same price",
  higher: "More expensive than us",
  varies: "It depends",
};

export const COMPETITOR_LIMITS = { name: 120, link: 200, line: 160, differentiator: 160, statement: 600 } as const;
export const COMPETITOR_LIST_MAX = 8;
export const MAX_COMPETITORS = 20;
export const MAX_DIFFERENTIATORS = 10;

/**
 * A website ("rival.rw" -> "https://rival.rw") or a social handle ("@rival.rw" stays as typed). Anything else is
 * refused, so a link shown on the page is always one of the two.
 */
export const competitorLinkSchema = z
  .string()
  .trim()
  .max(COMPETITOR_LIMITS.link, "That link is too long.")
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    if (/^@[\p{L}\p{N}._-]{1,60}$/u.test(v)) return v;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
    try {
      const url = new URL(withScheme);
      if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname.includes(".") || /\s/.test(v)) throw new Error();
      return url.toString().replace(/\/$/, "");
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a website (rival.rw) or a social handle (@rival)." });
      return z.NEVER;
    }
  });

export const competitorInputSchema = z.object({
  name: z.string().trim().min(1, "Enter the competitor's name.").max(COMPETITOR_LIMITS.name, `Use ${COMPETITOR_LIMITS.name} characters or fewer.`),
  link: competitorLinkSchema,
  strengths: chips(COMPETITOR_LIST_MAX, COMPETITOR_LIMITS.line, "strengths"),
  weaknesses: chips(COMPETITOR_LIST_MAX, COMPETITOR_LIMITS.line, "weaknesses"),
  pricePosition: z.union([z.enum(PRICE_POSITIONS), z.literal("")]).optional().default("").transform((v) => v || null),
});
export type CompetitorInput = z.input<typeof competitorInputSchema>;
export type CompetitorData = z.output<typeof competitorInputSchema>;

export type CompetitorRow = { name: string; link: string | null; strengths: string[]; weaknesses: string[]; pricePosition: string | null };

export type CompetitorFormValues = { name: string; link: string; strengths: string[]; weaknesses: string[]; pricePosition: string };
export const EMPTY_COMPETITOR: CompetitorFormValues = { name: "", link: "", strengths: [], weaknesses: [], pricePosition: "" };

export function competitorFormValues(c: CompetitorRow): CompetitorFormValues {
  return { name: c.name, link: c.link ?? "", strengths: c.strengths, weaknesses: c.weaknesses, pricePosition: c.pricePosition ?? "" };
}

export function isPricePosition(v: string | null | undefined): v is PricePosition {
  return !!v && (PRICE_POSITIONS as readonly string[]).includes(v);
}

/** The link as an href: a website as is; a handle has no network, so it is not a link. */
export function competitorHref(link: string | null): string | null {
  return link && /^https?:\/\//.test(link) ? link : null;
}

/** Business.positioning. */
export const positioningSchema = z.object({
  differentiators: chips(MAX_DIFFERENTIATORS, COMPETITOR_LIMITS.differentiator, "differentiators"),
  statement: optional(COMPETITOR_LIMITS.statement),
});
export type Positioning = z.output<typeof positioningSchema>;
export type PositioningInput = z.input<typeof positioningSchema>;

export const EMPTY_POSITIONING: Positioning = { differentiators: [], statement: null };

/** Reads Business.positioning field by field: a broken field is dropped on its own, never an error. */
export function readPositioning(value: unknown): Positioning {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_POSITIONING, differentiators: [] };
  const raw = value as Record<string, unknown>;
  const d = positioningSchema.shape.differentiators.safeParse(raw.differentiators ?? undefined);
  const s = positioningSchema.shape.statement.safeParse(raw.statement ?? undefined);
  return { differentiators: d.success ? d.data : [], statement: s.success ? s.data : null };
}

/**
 * Completeness, 0 to 100: a competitor (40), at least one differentiator (35) and the positioning statement (25).
 * Differentiators matter most to the writers; the competitors themselves are background.
 */
export function competitorsCompleteness(count: number, positioning: Positioning): { percent: number; summary: string } {
  const checks: [string, boolean, number][] = [
    ["a competitor", count > 0, 40],
    ["what makes you different", positioning.differentiators.length > 0, 35],
    ["a positioning statement", !!positioning.statement, 25],
  ];
  const percent = checks.reduce((s, [, ok, w]) => s + (ok ? w : 0), 0);
  const missing = checks.filter(([, ok]) => !ok).map(([label]) => label);
  return {
    percent,
    summary: missing.length ? `Add ${missing.slice(0, 2).join(" and ")}` : `${count} competitor${count === 1 ? "" : "s"} · ${positioning.differentiators.length} differentiator${positioning.differentiators.length === 1 ? "" : "s"}`,
  };
}
