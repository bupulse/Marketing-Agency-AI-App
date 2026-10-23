import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SectionKey, SectionProgress } from "@/lib/knowledge/sections";

let progress: Partial<Record<SectionKey, SectionProgress>> = {};
vi.mock("server-only", () => ({}));
vi.mock("@/lib/knowledge/overview", () => ({ knowledgeProgress: vi.fn(async () => progress) }));

import { quizEntry } from "@/lib/knowledge/quiz-entry";
import type { FeatureKey } from "@/lib/features";

const business = { timezone: "Africa/Kigali" } as Parameters<typeof quizEntry>[0];
const all = new Set<FeatureKey>(["content"] as FeatureKey[]);
const p = (percent: number): SectionProgress => ({ percent, summary: "" });

describe("where the Business info quiz starts (Business info page and dashboard home)", () => {
  beforeEach(() => {
    progress = {};
  });

  it("starts from the top when nothing is filled in", async () => {
    const e = await quizEntry(business, "OWNER", all);
    expect(e).toMatchObject({ overall: 0, playable: true, href: "/dashboard/knowledge/quiz", label: "Start the quiz" });
    expect(e.nextRound).toEqual({ emoji: "🏠", title: "You" });
  });

  it("continues at the first round whose section is not complete", async () => {
    progress = { profile: p(100), products: p(40), audience: p(0) };
    const e = await quizEntry(business, "OWNER", all);
    expect(e.label).toBe("Continue");
    expect(e.href).toBe("/dashboard/knowledge/quiz?round=sell");
    expect(e.nextRound).toEqual({ emoji: "🛍️", title: "What you sell" });
    expect(e.overall).toBeGreaterThan(0);
  });

  it("continues at Photos when the products only lack photos, and at Your look for the logo", async () => {
    progress = { profile: p(100), products: { percent: 0, summary: "2 items · 2 need details", next: "Add photos to 2 products" } };
    expect((await quizEntry(business, "OWNER", all)).href).toBe("/dashboard/knowledge/quiz?round=photos");
    progress = { profile: p(100), products: p(100), audience: p(100), competitors: p(100), faqs: p(100), locations: p(100), brand: p(33) };
    expect((await quizEntry(business, "OWNER", all)).href).toBe("/dashboard/knowledge/quiz?round=look");
  });

  it("sends a profile that lacks only its service area to Find us", async () => {
    progress = { profile: { percent: 95, summary: "Add your service area" }, products: p(100) };
    expect((await quizEntry(business, "OWNER", all)).href).toBe("/dashboard/knowledge/quiz?round=find");
  });

  it("says play again when everything is complete", async () => {
    progress = { profile: p(100) };
    const e = await quizEntry(business, "OWNER", all);
    expect(e).toMatchObject({ overall: 100, label: "Play again", href: "/dashboard/knowledge/quiz", nextRound: null });
  });

  it("is not playable for a member on a plan without content who may not edit the company settings", async () => {
    const e = await quizEntry(business, "MEMBER", new Set());
    expect(e.playable).toBe(false);
  });
});
