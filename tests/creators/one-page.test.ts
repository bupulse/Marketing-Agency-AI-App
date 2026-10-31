import { describe, expect, it } from "vitest";

// The one-page creator campaign form (lib/creators/one-page.ts, owner decision 31 October 2026): the checks the form
// and the server share, the live summary, the budget warning, picking the product, and how the answers become the
// campaign and the pay rules lib/creators/pay.ts uses.

import { computePeriodPay } from "@/lib/creators/pay";
import {
  budgetWarning,
  CAMPAIGN_LANGUAGES,
  checkOnePage,
  languageFromName,
  languageLabel,
  languageOf,
  mentionsInText,
  minimumNote,
  onePageCampaign,
  placeLimit,
  summaryLine,
  withProduct,
  type OnePageInput,
} from "@/lib/creators/one-page";

const input = (over: Partial<OnePageInput> = {}): OnePageInput => ({
  language: "rw",
  description: "Film yourself trying our passion juice at home. One video a week. Use #LeafJuice and tag @leaf.rw.",
  currency: "RWF",
  ratePerThousand: 500,
  budget: 500_000,
  maxPerCreator: 50_000,
  unlimitedCreators: false,
  maxCreators: 10,
  platforms: ["instagram", "facebook"],
  coverAssetId: "a-cover",
  productId: "p1",
  productName: "Passion juice",
  productLinks: ["https://example.com/passion-juice"],
  productPhotoIds: ["a1", "a2"],
  ...over,
});

const problem = (over: Partial<OnePageInput>) => {
  const r = checkOnePage(input(over));
  return r.ok ? null : { error: r.error, field: r.field };
};

describe("the pay per 1,000 views", () => {
  it("is 500 RWF at least, with the note the form shows", () => {
    expect(minimumNote("RWF")).toBe("500 RWF is the minimum for 1,000 views.");
    expect(checkOnePage(input({ ratePerThousand: 500 })).ok).toBe(true);
    expect(problem({ ratePerThousand: 499 })).toEqual({ error: "500 RWF is the minimum for 1,000 views.", field: "ratePerThousand" });
    expect(problem({ ratePerThousand: 0 })?.field).toBe("ratePerThousand");
  });

  it("refuses an empty price, a broken number and a typing mistake", () => {
    expect(problem({ ratePerThousand: null as unknown as number })).toEqual({ error: "Write the pay for 1,000 views.", field: "ratePerThousand" });
    expect(problem({ ratePerThousand: 750.5 })?.error).toBe("Use a whole number.");
    expect(problem({ ratePerThousand: 25_000 })?.error).toMatch(/looks like a typing mistake: the most is 20,000 RWF/);
  });
});

describe("how many creators can join", () => {
  it("is a number, or Unlimited", () => {
    expect(checkOnePage(input({ unlimitedCreators: false, maxCreators: 20 })).ok).toBe(true);
    expect(problem({ unlimitedCreators: false, maxCreators: null })).toEqual({ error: "Write how many creators can join, or pick Unlimited.", field: "maxCreators" });
    expect(problem({ unlimitedCreators: false, maxCreators: 0 })?.field).toBe("maxCreators");
    expect(checkOnePage(input({ unlimitedCreators: true, maxCreators: null })).ok).toBe(true);
  });

  it("stores Unlimited as no limit of the campaign's own, whatever number was typed before", () => {
    const r = checkOnePage(input({ unlimitedCreators: true, maxCreators: 7 }));
    expect(r.ok && onePageCampaign(r.data, "2026-11-01").maxCreators).toBeNull();
    const n = checkOnePage(input({ maxCreators: 7 }));
    expect(n.ok && onePageCampaign(n.data, "2026-11-01").maxCreators).toBe(7);
  });

  it("holds at most the plan's places; unlimited is the plan's", () => {
    expect(placeLimit(20, 5)).toBe(5);
    expect(placeLimit(20, 50)).toBe(20);
    expect(placeLimit(20, null)).toBe(20);
    expect(placeLimit(20, undefined)).toBe(20);
  });
});

describe("the budget and the most per creator", () => {
  const money = { budget: 500_000, maxPerCreator: 50_000, maxCreators: 10, unlimitedCreators: false, planLimit: 20, currency: "RWF" };

  it("warns, without blocking, when every creator earning the most costs more than the budget", () => {
    expect(budgetWarning(money)).toBeNull(); // 10 × 50,000 = 500,000: it fits
    expect(budgetWarning({ ...money, maxCreators: 11 })).toBe("11 creators earning 50,000 RWF each is 550,000 RWF, more than your budget of 500,000 RWF. You can still create it: when the budget runs out, the pay is shared between the creators to fit it.");
    expect(checkOnePage(input({ maxCreators: 11 })).ok).toBe(true);
  });

  it("counts the plan's creators for Unlimited, and waits for both numbers", () => {
    expect(budgetWarning({ ...money, unlimitedCreators: true, maxCreators: null })).toMatch(/^Up to 20 creators \(unlimited, on your plan\) earning 50,000 RWF each is 1,000,000 RWF/);
    expect(budgetWarning({ ...money, budget: null })).toBeNull();
    expect(budgetWarning({ ...money, maxPerCreator: null })).toBeNull();
  });

  it("are needed, as whole numbers", () => {
    expect(problem({ budget: null as unknown as number })).toEqual({ error: "Write the campaign budget.", field: "budget" });
    expect(problem({ maxPerCreator: 0 })).toEqual({ error: "Write the most one creator can earn.", field: "maxPerCreator" });
  });

  it("shows the live summary", () => {
    expect(summaryLine({ ...money, maxCreators: 20, ratePerThousand: 500 })).toBe("Up to 20 creators · 500 RWF per 1,000 views · max 50,000 RWF each · budget 500,000 RWF");
    expect(summaryLine({ ...money, unlimitedCreators: true, ratePerThousand: 1_000 })).toBe("Unlimited creators · 1,000 RWF per 1,000 views · max 50,000 RWF each · budget 500,000 RWF");
    expect(summaryLine({ ...money, maxCreators: 1, ratePerThousand: null, budget: null })).toBe("Up to 1 creator · max 50,000 RWF each");
  });
});

describe("the language", () => {
  it("is one of English, Kinyarwanda, French and Swahili, picked first", () => {
    expect(CAMPAIGN_LANGUAGES.map((l) => l.label)).toEqual(["English", "Kinyarwanda", "French", "Swahili"]);
    for (const code of ["en", "rw", "fr", "sw"] as const) expect(checkOnePage(input({ language: code })).ok).toBe(true);
    expect(problem({ language: "de" as never })).toEqual({ error: "Pick the language of the campaign.", field: "language" });
  });

  it("starts from the business's content language, and reads old campaigns as English", () => {
    expect(languageFromName("Kinyarwanda")).toBe("rw");
    expect(languageFromName("french")).toBe("fr");
    expect(languageFromName("Spanish")).toBe("en");
    expect(languageOf("sw")).toBe("sw");
    expect(languageOf(null)).toBe("en");
    expect(languageLabel("rw")).toBe("Kinyarwanda");
  });
});

describe("the description", () => {
  it("is needed, in a few sentences, and its @accounts and #hashtags become the caption check", () => {
    expect(problem({ description: "Juice" })).toEqual({ error: "Describe the campaign and what creators should post, in a few sentences.", field: "description" });
    expect(problem({ description: "x".repeat(2_001) })?.field).toBe("description");
    expect(mentionsInText("Use #LeafJuice and tag @leaf.rw. Again: #leafjuice, email me@x.com, #a")).toEqual(["#LeafJuice", "@leaf.rw"]);
  });
});

describe("the networks, the picture and the product", () => {
  it("needs a network the campaigns support", () => {
    expect(problem({ platforms: [] })).toEqual({ error: "Pick at least one network to post on.", field: "platforms" });
    expect(problem({ platforms: ["youtube" as never] })?.field).toBe("platforms");
    expect(checkOnePage(input({ platforms: ["tiktok"] })).ok).toBe(true);
  });

  it("checks the product's links", () => {
    expect(problem({ productLinks: ["not a link"] })).toEqual({ error: "Paste full links, starting with https://", field: "productLinks" });
    expect(checkOnePage(input({ coverAssetId: null, productId: null, productName: "", productLinks: [], productPhotoIds: [] })).ok).toBe(true);
  });

  it("fills the product name and its photos when a product is picked, and keeps the owner's own pictures", () => {
    const empty = { productId: null, productName: "", productPhotoIds: [], fromProduct: [] };
    const juice = withProduct(empty, { id: "p1", name: "Passion juice" }, ["a1", "a2"]);
    expect(juice).toEqual({ productId: "p1", productName: "Passion juice", productPhotoIds: ["a1", "a2"], fromProduct: ["a1", "a2"] });
    // The owner adds a picture, then picks another product: its photos replace the first one's; theirs stays.
    const added = { ...juice, productPhotoIds: [...juice.productPhotoIds, "mine"] };
    expect(withProduct(added, { id: "p2", name: "Mango juice" }, ["b1"])).toEqual({ productId: "p2", productName: "Mango juice", productPhotoIds: ["b1", "mine"], fromProduct: ["b1"] });
    // No product: the name is emptied for them to type, their own pictures stay.
    expect(withProduct(added, null)).toEqual({ productId: null, productName: "", productPhotoIds: ["mine"], fromProduct: [] });
  });
});

describe("the campaign it makes", () => {
  const r = checkOnePage(input());
  if (!r.ok) throw new Error(r.error);
  const c = onePageCampaign(r.data, "2026-11-01");

  it("maps every answer to the campaign", () => {
    expect(c).toMatchObject({
      language: "rw",
      idea: input().description,
      platforms: ["instagram", "facebook"],
      currency: "RWF",
      budget: 500_000,
      maxCreators: 10,
      coverAssetId: "a-cover",
      productIds: ["p1"],
      product: { productName: "Passion juice", productLinks: ["https://example.com/passion-juice"], productPhotoIds: ["a1", "a2"] },
      languages: ["Kinyarwanda"],
    });
  });

  it("runs from today for 30 days: one pay period, so the budget is the whole campaign's", () => {
    expect(c.startsOn).toBe("2026-11-01");
    expect(c.endsOn).toBe("2026-11-30");
  });

  it("pays per 1,000 views and caps each creator, in lib/creators/pay.ts", () => {
    expect(c.payRules).toEqual({ ratePerThousand: 500, rateViews: 1_000, feePerPost: null, milestones: [], capPerPost: null, capPerCreator: 50_000 });
    const post = (creatorId: string, views: number) => ({ postId: `${creatorId}-1`, creatorId, status: "TRACKING", postedInPeriod: true, viewsAtStart: 0, viewsAtEnd: views });
    // 40,000 views earn 20,000 RWF; 300,000 views would earn 150,000 RWF, capped at 50,000.
    const pay = computePeriodPay(c.payRules, { budget: c.budget }, [post("a", 40_000), post("b", 300_000)]);
    expect(pay.creators.map((x) => [x.creatorId, x.amount])).toEqual([["a", 20_000], ["b", 50_000]]);
    expect(pay.limitsHit).toContain("capPerCreator");
    // Twelve creators at the cap need 600,000 RWF: the 500,000 budget shares it out.
    const many = computePeriodPay(c.payRules, { budget: c.budget }, Array.from({ length: 12 }, (_, i) => post(`c${i}`, 200_000)));
    expect(many.amount).toBe(500_000);
    expect(many.limitsHit).toContain("budget");
  });
});
