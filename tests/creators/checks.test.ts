import { describe, expect, it, vi } from "vitest";
import { readApplication, readFollowers, cleanHandle } from "@/lib/creators/application";
import { readQuestions } from "@/lib/creators/company-forms";
import { formatSpan, creatorPayInWords, taskRuleInWords } from "@/lib/creators/describe";
import { handInDays, linksProblem, tasksForDay } from "@/lib/creators/tasks";
import { failReason, hasMention, onTime } from "@/lib/creators/tracking/checks";
import { expandShortLink, parsePostLink } from "@/lib/creators/tracking/links";
import { nextReadAt, numbersOf } from "@/lib/creators/tracking/numbers";

const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

describe("reading post links", () => {
  it("finds the Instagram shortcode in posts, reels and links with a username", () => {
    expect(parsePostLink("instagram", "https://www.instagram.com/reel/DAbC123xyz/?igsh=abc")).toMatchObject({ shortcode: "DAbC123xyz", short: false });
    expect(parsePostLink("instagram", "https://instagram.com/p/C9zz_-1Q/")).toMatchObject({ shortcode: "C9zz_-1Q" });
    expect(parsePostLink("instagram", "https://www.instagram.com/ana.rw/reel/DAbC123xyz/")).toMatchObject({ shortcode: "DAbC123xyz" });
    expect(parsePostLink("instagram", "https://www.instagram.com/ana.rw/")).toBeNull();
    expect(parsePostLink("instagram", "https://www.tiktok.com/@ana/video/7412345678901234567")).toBeNull();
  });

  it("finds the TikTok video id, and marks share links to follow", () => {
    expect(parsePostLink("tiktok", "https://www.tiktok.com/@ana.rw/video/7412345678901234567?is_from_webapp=1")).toMatchObject({ videoId: "7412345678901234567", short: false });
    expect(parsePostLink("tiktok", "https://vm.tiktok.com/ZMabc123/")).toMatchObject({ short: true });
    expect(parsePostLink("tiktok", "https://www.tiktok.com/t/ZTabc123/")).toMatchObject({ short: true });
  });

  it("keeps every id of a Facebook link", () => {
    expect(parsePostLink("facebook", "https://www.facebook.com/permalink.php?story_fbid=1234567890&id=99887766")?.ids).toEqual(["1234567890", "99887766"]);
    expect(parsePostLink("facebook", "https://www.facebook.com/leafshop/posts/pfbid02AbCdEfGhIjKlMnOp")?.ids).toEqual(["pfbid02AbCdEfGhIjKlMnOp"]);
    expect(parsePostLink("facebook", "https://fb.watch/abcDEF/")).toMatchObject({ short: true });
    expect(parsePostLink("facebook", "https://evil.example/posts/1234567890")).toBeNull();
  });

  it("follows a share link on the network's own hosts only", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "https://www.tiktok.com/@ana.rw/video/7412345678901234567?_r=1" } }));
    expect(await expandShortLink(parsePostLink("tiktok", "https://vm.tiktok.com/ZMabc123/")!, fetch)).toMatchObject({ videoId: "7412345678901234567" });
    const away = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://evil.example/x" } }));
    expect(await expandShortLink(parsePostLink("tiktok", "https://vm.tiktok.com/ZMabc123/")!, away)).toBeNull();
  });
});

describe("the on-time check", () => {
  it("accepts the task's day and the day either side, in the company's timezone", () => {
    // 23:30 in Kigali on 20 October is 21:30 UTC.
    expect(onTime(new Date("2026-10-20T21:30:00Z"), "2026-10-20", "Africa/Kigali")).toBe(true);
    expect(onTime(new Date("2026-10-21T21:30:00Z"), "2026-10-20", "Africa/Kigali")).toBe(true);
    expect(onTime(new Date("2026-10-18T22:30:00Z"), "2026-10-20", "Africa/Kigali")).toBe(true); // 00:30 on the 19th
    expect(onTime(new Date("2026-10-18T21:30:00Z"), "2026-10-20", "Africa/Kigali")).toBe(false); // 23:30 on the 18th: two days before
    expect(onTime(new Date("2026-10-22T22:30:00Z"), "2026-10-20", "Africa/Kigali")).toBe(false);
  });
});

describe("the mention check", () => {
  it("needs one of the mentions, any letter case, standing on its own", () => {
    expect(hasMention("Loving my new shoes from @LeafShop! #ad", ["@leafshop"])).toBe(true);
    expect(hasMention("Loving @leafshopping", ["@leafshop"])).toBe(false);
    expect(hasMention("New in #Leaf.", ["#leaf", "@leafshop"])).toBe(true);
    expect(hasMention("#leafy", ["#leaf"])).toBe(false);
    expect(hasMention("Shop now at www.leaf.rw/sale", ["https://leaf.rw/sale"])).toBe(true);
    expect(hasMention("Shop now", ["leaf.rw"])).toBe(false);
    expect(hasMention(null, ["@leafshop"])).toBe(false);
    expect(hasMention("anything", [])).toBe(true);
  });

  it("explains each failure in plain words", () => {
    expect(failReason({ ownAccount: false, onTime: null, mention: null }, [], "Instagram")).toMatch(/could not find this post on the Instagram account/);
    expect(failReason({ ownAccount: true, onTime: false, mention: true }, [], "TikTok")).toMatch(/not made on the task's day/);
    expect(failReason({ ownAccount: true, onTime: true, mention: false }, ["@leaf", "#leaf"], "TikTok")).toMatch(/one of @leaf, #leaf/);
    expect(failReason({ ownAccount: true, onTime: true, mention: true }, [], "TikTok")).toBeNull();
  });
});

describe("tasks by day", () => {
  const task = { id: "t1", startsOn: d("2026-10-01"), endsOn: d("2026-10-07"), postsPerDay: 2, platforms: ["instagram", "tiktok"], platformMode: "ALL", mediaKind: "VIDEO" };

  it("lists the tasks of a day, with what is left", () => {
    const today = tasksForDay([task, { ...task, id: "t2", startsOn: d("2026-10-08"), endsOn: d("2026-10-14") }], "2026-10-03", new Map([["t1|2026-10-03", 1]]));
    expect(today).toHaveLength(1);
    expect(today[0]).toMatchObject({ due: 2, handedIn: 1, left: 1 });
    expect(handInDays(task, "2026-10-03")).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("checks the ALL and ANY rules of the links", () => {
    expect(linksProblem(task, { instagram: "https://instagram.com/p/x" })).toMatch(/TikTok/);
    expect(linksProblem(task, { instagram: "a", tiktok: "b" })).toBeNull();
    expect(linksProblem({ ...task, platformMode: "ANY" }, { tiktok: "b" })).toBeNull();
    expect(linksProblem({ ...task, platformMode: "ANY" }, {})).toMatch(/Add the link/);
    expect(linksProblem(task, { instagram: "a", tiktok: "b", facebook: "c" })).toMatch(/not for Facebook/);
    expect(taskRuleInWords(task)).toBe("2 videos a day, on each of Instagram and TikTok");
    expect(taskRuleInWords({ ...task, platformMode: "ANY", postsPerDay: 1, mediaKind: "ANY" })).toBe("1 post a day, on Instagram or TikTok");
  });
});

describe("pay rules in plain words", () => {
  it("says the owner's example the way a creator reads it", () => {
    expect(creatorPayInWords({ ratePerThousand: 2000 }, { viewTargetPerCreator: 50_000 }, "RWF")).toEqual(["2,000 RWF for every 1,000 views, up to 50,000 views a month"]);
    const lines = creatorPayInWords({ ratePerThousand: 1000, milestones: [{ views: 10_000, amount: 5000 }], feePerPost: 500, capPerPost: 20_000 }, { budget: 300_000, viewTargetCampaign: 1_000_000 }, "RWF");
    expect(lines[0]).toBe("1,000 RWF for every 1,000 views");
    expect(lines).toContain("5,000 RWF once, when a post reaches 10,000 views");
    expect(lines.some((l) => l.includes("pass 1,000,000 views"))).toBe(true);
    expect(creatorPayInWords({ feePerPost: 500 }, { viewTargetPerCreator: 20_000 }, "RWF")[0]).toBe("Views count up to 20,000 a month");
    expect(lines.at(-1)).toMatch(/budget is 300,000 RWF/);
    expect(formatSpan("2026-10-21", "2026-11-19")).toBe("21 October – 19 November 2026");
  });
});

describe("the application form", () => {
  const campaign = { platforms: ["instagram", "tiktok"], questions: readQuestions([{ id: "why", label: "Why you?", required: true }]), country: "Rwanda" };
  const form = (values: Record<string, string>) => new Map(Object.entries(values));

  it("reads a good application, with the WhatsApp number in E.164", () => {
    const r = readApplication(form({ name: "Ana Uwase", email: "Ana@Example.com ", phone: "0791 954 277", handle_instagram: "@ana.rw", followers_instagram: "12.5k", sample_1: "https://www.instagram.com/p/abc123/", q_why: "I love shoes" }), campaign);
    expect(r).toEqual({ ok: true, value: { name: "Ana Uwase", email: "ana@example.com", phone: "+250791954277", handles: [{ network: "instagram", handle: "ana.rw", followers: 12_500 }], samples: ["https://www.instagram.com/p/abc123/"], answers: { why: "I love shoes" } } });
    expect(campaign.questions).toHaveLength(1);
  });

  it("says what is missing, field by field", () => {
    const r = readApplication(form({ name: "A", email: "nope", phone: "12", sample_1: "instagram.com/x" }), campaign);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["email", "handles", "name", "phone", "q_why", "sample_1"]);
  });

  it("reads handles and follower counts the way people type them", () => {
    expect(cleanHandle("https://www.tiktok.com/@ana.rw?lang=en")).toBe("ana.rw");
    expect(readFollowers("1.5M")).toBe(1_500_000);
    expect(readFollowers("12,300")).toBe(12_300);
    expect(readFollowers("lots")).toBeNull();
  });
});

describe("numbers and reading times", () => {
  it("keeps numbers the network left out, and never lets views go down", () => {
    const previous = { views: 900, impressions: 700, likes: 40, comments: 5, shares: 3 };
    expect(numbersOf({ externalId: "m", permalink: null, postedAt: null, caption: null, views: 850, reach: null, likes: 42, comments: null, shares: 4 }, previous)).toEqual({ views: 900, impressions: 700, likes: 42, comments: 5, shares: 4 });
  });

  it("reads posts up to 7 days old every 6 hours, older ones once a day", () => {
    const now = new Date("2026-10-21T12:00:00Z");
    expect(nextReadAt(new Date("2026-10-20T12:00:00Z"), now).toISOString()).toBe("2026-10-21T18:00:00.000Z");
    expect(nextReadAt(new Date("2026-10-01T12:00:00Z"), now).toISOString()).toBe("2026-10-22T12:00:00.000Z");
  });
});
