import { describe, expect, it } from "vitest";
import { holidaysBetween } from "@/lib/autopilot/calendar";
import { buildProfile, EMPTY_PROFILE, type PostResult } from "@/lib/autopilot/learning";
import { buildWeekPlan, type PlanInput, type PlanPhoto, type PlanProject } from "@/lib/autopilot/planner";
import { ideaNetworks } from "@/lib/autopilot/playbook";
import { DEFAULT_CONFIG } from "@/lib/autopilot/settings";
import { localDateISO, localParts, nextWeekStart, weekDates } from "@/lib/autopilot/timezone";

const TZ = "Africa/Kigali";
const now = new Date("2026-10-09T08:00:00Z"); // Friday
const weekStart = nextWeekStart(now, TZ); // Monday 12 Oct 2026

const conn = (id: string, network: PlanInput["connections"][number]["network"]) => ({ id, network });
const ALL = [conn("c-ig", "instagram"), conn("c-fb", "facebook"), conn("c-li", "linkedin"), conn("c-tt", "tiktok")];

const project = (id: string, type: string, over: Partial<PlanProject> = {}): PlanProject => ({
  id,
  title: `Project ${id}`,
  type,
  price: type === "offer" ? "20% off" : null,
  features: ["one", "two"],
  photoPaths: [],
  createdAt: new Date("2026-10-01"),
  postedCount: 0,
  lastPostedAt: null,
  ...over,
});

const photo = (id: string, folderId: string | null, recentUses = 0, mimeType = "image/jpeg"): PlanPhoto => ({ id, path: `u/gallery/${id}.jpg`, folderId, mimeType, recentUses });

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    businessId: "biz1",
    weekStart,
    timeZone: TZ,
    country: "Rwanda",
    industryTags: [],
    config: { ...DEFAULT_CONFIG, enabled: true, postsPerWeek: 5, connectionIds: ALL.map((c) => c.id) },
    connections: ALL,
    projects: [project("p1", "product"), project("p2", "offer"), project("p3", "project", { photoPaths: ["u/projects/a.jpg", "u/projects/b.jpg"] })],
    faqs: [{ question: "Do you deliver?", answer: "Yes, within Kigali." }],
    hasHours: true,
    holidays: [],
    photos: [photo("1", "f1"), photo("2", "f2"), photo("3", "f1"), photo("4", null), photo("5", "f2"), photo("6", "f3")],
    existing: [],
    recentIdeas: new Map(),
    profile: EMPTY_PROFILE,
    now,
    ...over,
  };
}

describe("week plan distribution", () => {
  it("plans the requested number of post ideas, each idea once", () => {
    for (const n of [2, 3, 5, 7, 14]) {
      const plan = buildWeekPlan(input({ config: { ...DEFAULT_CONFIG, postsPerWeek: n, connectionIds: [] } }));
      expect(plan.groups.length, `n=${n}`).toBeLessThanOrEqual(n);
      expect(plan.groups.length, `n=${n}`).toBeGreaterThanOrEqual(Math.min(n, 5));
      const ids = plan.groups.map((g) => g.idea.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("gives every connected network a post when there is room, with a different version per network", () => {
    const plan = buildWeekPlan(input());
    const networks = new Set(plan.groups.flatMap((g) => g.posts.map((p) => p.network)));
    expect(networks).toEqual(new Set(["instagram", "facebook", "linkedin", "tiktok"]));
  });

  it("honours network rules: video networks get scripts, articles are LinkedIn only, images go to Instagram and Facebook", () => {
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      const plan = buildWeekPlan(input({ businessId: seed, config: { ...DEFAULT_CONFIG, postsPerWeek: 8, connectionIds: [] } }));
      for (const g of plan.groups) {
        for (const p of g.posts) {
          if (p.network === "tiktok" || p.network === "youtube") expect(p.format).toBe("SCRIPT");
          if (p.format === "ARTICLE") expect(p.network).toBe("linkedin");
          if (p.network === "instagram") expect(["POST", "CAROUSEL", "SCRIPT"]).toContain(p.format);
          expect(ideaNetworks(g.idea)).toContain(p.network);
        }
      }
    }
  });

  it("includes a LinkedIn article among three or more posts", () => {
    const plan = buildWeekPlan(input({ connections: [conn("c-li", "linkedin"), conn("c-ig", "instagram")] }));
    expect(plan.groups.some((g) => g.posts.some((p) => p.network === "linkedin" && p.format === "ARTICLE"))).toBe(true);
  });

  it("plans only for the accounts it has", () => {
    const plan = buildWeekPlan(input({ connections: [conn("c-li", "linkedin")] }));
    expect(plan.groups.length).toBeGreaterThan(0);
    expect(plan.groups.every((g) => g.posts.every((p) => p.network === "linkedin"))).toBe(true);
    expect(buildWeekPlan(input({ connections: [] })).groups).toEqual([]);
  });

  it("is repeatable for the same business and week", () => {
    const shape = (p: ReturnType<typeof buildWeekPlan>) => p.groups.map((g) => [g.idea.id, g.day, g.posts.map((x) => x.scheduledAt.toISOString())]);
    expect(shape(buildWeekPlan(input()))).toEqual(shape(buildWeekPlan(input())));
  });

  it("skips ideas whose facts are missing instead of inventing them", () => {
    const plan = buildWeekPlan(input({ projects: [], faqs: [], hasHours: false, config: { ...DEFAULT_CONFIG, postsPerWeek: 14, connectionIds: [] } }));
    const needing = plan.groups.filter((g) => g.idea.needs.some((n) => n !== "holiday"));
    expect(needing).toEqual([]);
  });

  it("uses a project at most once a week and prefers new, never-posted ones", () => {
    const projects = [project("old", "product", { postedCount: 3, lastPostedAt: new Date("2026-09-01") }), project("fresh", "product", { createdAt: new Date("2026-10-08") })];
    const used: string[] = [];
    for (const seed of ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]) {
      const plan = buildWeekPlan(input({ businessId: seed, projects, config: { ...DEFAULT_CONFIG, postsPerWeek: 6, connectionIds: [] } }));
      const ids = plan.groups.flatMap((g) => (g.project ? [g.project.id] : []));
      expect(new Set(ids).size).toBe(ids.length);
      used.push(...ids);
    }
    expect(used.filter((id) => id === "fresh").length).toBeGreaterThanOrEqual(used.filter((id) => id === "old").length);
  });
});

describe("days and times", () => {
  it("spreads posts over different days", () => {
    const plan = buildWeekPlan(input({ config: { ...DEFAULT_CONFIG, postsPerWeek: 5, connectionIds: [] } }));
    const days = plan.groups.map((g) => g.day);
    expect(new Set(days).size).toBeGreaterThanOrEqual(4);
    const week = weekDates(weekStart, TZ);
    for (const d of days) expect(week).toContain(d);
  });

  it("schedules at the owner's posting times in the business time zone", () => {
    const plan = buildWeekPlan(input({ config: { ...DEFAULT_CONFIG, postsPerWeek: 4, postingTimes: ["09:00", "18:00"], connectionIds: [] } }));
    for (const g of plan.groups) {
      for (const p of g.posts) {
        const local = localParts(p.scheduledAt, TZ);
        expect(localDateISO(p.scheduledAt, TZ)).toBe(g.day);
        expect([9, 18]).toContain(local.hour);
        expect(local.minute).toBe(0);
      }
    }
    // 09:00 in Kigali is 07:00 UTC.
    const utcHours = plan.groups.flatMap((g) => g.posts.map((p) => p.scheduledAt.getUTCHours()));
    expect(utcHours.every((h) => h === 7 || h === 16)).toBe(true);
  });

  it("converts times for another zone (New York, summer time)", () => {
    const plan = buildWeekPlan(input({ timeZone: "America/New_York", weekStart: nextWeekStart(now, "America/New_York"), config: { ...DEFAULT_CONFIG, postsPerWeek: 3, postingTimes: ["09:00"], connectionIds: [] } }));
    for (const g of plan.groups) for (const p of g.posts) expect(p.scheduledAt.getUTCHours()).toBe(13); // 09:00 EDT
  });

  // Past posts that did well at some hour (in the business zone) must only ORDER the owner's posting times, never add
  // hours of their own: this is the bug found with Nova Phones' week (history at 09:00 UTC = 11:00 Kigali made the
  // planner post at 11:00 and 20:00 local although the settings said 09:00 and 18:00).
  const history = (network: PostResult["network"], utcHour: number, n = 4): PostResult[] =>
    Array.from({ length: n }, (_, i) => ({ playbookId: "tip-how-to", network, publishedAt: new Date(`2026-09-1${(i % 6) + 4}T${String(utcHour).padStart(2, "0")}:00:00Z`), reach: 1000, likes: 80, comments: 0, saves: 0, shares: 0 }));

  it("keeps the owner's posting times in Africa/Kigali when the history did best two hours later", () => {
    const profile = buildProfile([...history("instagram", 9), ...history("facebook", 18)], TZ);
    expect(profile.confident).toBe(true);
    expect(profile.bestHours.get("instagram")).toEqual([11]); // 09:00 UTC is 11:00 in Kigali
    expect(profile.bestHours.get("facebook")).toEqual([20]);
    const plan = buildWeekPlan(input({ profile, config: { ...DEFAULT_CONFIG, postsPerWeek: 4, postingTimes: ["09:00", "18:00"], connectionIds: [] } }));
    expect(plan.groups.length).toBeGreaterThan(0);
    for (const g of plan.groups) {
      for (const p of g.posts) {
        expect([9, 18]).toContain(localParts(p.scheduledAt, TZ).hour);
        expect([7, 16]).toContain(p.scheduledAt.getUTCHours()); // 09:00 and 18:00 Kigali, never 09:00 UTC
      }
    }
  });

  it("keeps the owner's posting times in a zone behind UTC (America/Sao_Paulo, UTC-3) too", () => {
    const tz = "America/Sao_Paulo";
    const profile = buildProfile(history("instagram", 9, 8), tz); // 09:00 UTC is 06:00 in Sao Paulo
    expect(profile.bestHours.get("instagram")).toEqual([6]);
    const plan = buildWeekPlan(input({ timeZone: tz, weekStart: nextWeekStart(now, tz), profile, config: { ...DEFAULT_CONFIG, postsPerWeek: 3, postingTimes: ["09:00"], connectionIds: [] } }));
    expect(plan.groups.length).toBeGreaterThan(0);
    for (const g of plan.groups) {
      for (const p of g.posts) {
        expect(localParts(p.scheduledAt, tz).hour).toBe(9);
        expect(p.scheduledAt.getUTCHours()).toBe(12);
      }
    }
  });

  it("never puts two posts on one account closer than 2.5 hours, new or existing", () => {
    const monday9 = new Date("2026-10-12T07:00:00Z");
    const plan = buildWeekPlan(input({ config: { ...DEFAULT_CONFIG, postsPerWeek: 10, postingTimes: ["09:00"], connectionIds: [] }, existing: [{ connectionId: "c-ig", scheduledAt: monday9 }] }));
    const byConnection = new Map<string, number[]>();
    for (const g of plan.groups) for (const p of g.posts) byConnection.set(p.connectionId, [...(byConnection.get(p.connectionId) ?? []), p.scheduledAt.getTime()]);
    byConnection.get("c-ig")?.push(monday9.getTime());
    for (const times of byConnection.values()) {
      const sorted = [...times].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(150 * 60_000);
    }
  });

  it("never schedules in the past when planning mid-week", () => {
    const wednesday = new Date("2026-10-14T10:00:00Z");
    const plan = buildWeekPlan(input({ now: wednesday, config: { ...DEFAULT_CONFIG, postsPerWeek: 6, connectionIds: [] } }));
    expect(plan.groups.length).toBeGreaterThan(0);
    for (const g of plan.groups) for (const p of g.posts) expect(p.scheduledAt.getTime()).toBeGreaterThan(wednesday.getTime());
  });

  it("plans nothing when the week is over", () => {
    const plan = buildWeekPlan(input({ now: new Date("2026-10-20T10:00:00Z") }));
    expect(plan.groups).toEqual([]);
  });
});

describe("holidays", () => {
  const week = weekDates(weekStart, TZ);
  const holidays = holidaysBetween("Kenya", week[0], week[6]); // Mashujaa Day, Tue 20 Oct is next week; use a custom one below

  it("posts a greeting on the holiday itself", () => {
    const custom = [{ id: "ke-mashujaa", date: week[2], name: "Mashujaa Day", scope: "national" as const, religious: false }];
    const plan = buildWeekPlan(input({ holidays: custom }));
    const g = plan.groups.find((x) => x.holiday);
    expect(g).toBeDefined();
    expect(g!.day).toBe(week[2]);
    expect(["holiday-greeting", "holiday-offer"]).toContain(g!.idea.id);
    expect(holidays).toBeDefined();
  });

  it("keeps remembrance days quiet", () => {
    const quiet = [{ id: "rw-kwibuka", date: week[1], name: "Kwibuka", scope: "national" as const, religious: false, sensitive: true }];
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const plan = buildWeekPlan(input({ businessId: seed, holidays: quiet, config: { ...DEFAULT_CONFIG, postsPerWeek: 7, connectionIds: [] } }));
      expect(plan.groups.every((g) => g.day !== week[1])).toBe(true);
      expect(plan.groups.every((g) => !g.holiday)).toBe(true);
    }
  });

  it("offers a holiday offer only for shopping days when an offer exists", () => {
    const shopping = [{ id: "black-friday", date: week[4], name: "Black Friday", scope: "global" as const, religious: false, commercial: true }];
    const seen = new Set<string>();
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]) {
      const plan = buildWeekPlan(input({ businessId: seed, holidays: shopping }));
      for (const g of plan.groups) if (g.holiday) seen.add(g.idea.id);
    }
    expect([...seen].every((id) => ["holiday-greeting", "holiday-offer"].includes(id))).toBe(true);
    const plain = [{ id: "x", date: week[4], name: "Quiet day", scope: "global" as const, religious: false }];
    const plan = buildWeekPlan(input({ holidays: plain }));
    expect(plan.groups.every((g) => g.idea.id !== "holiday-offer")).toBe(true);
  });
});

describe("photos", () => {
  it("prefers photos not used recently and varies folders", () => {
    const photos = [photo("old1", "f1", 4), photo("old2", "f1", 4), photo("new1", "f1", 0), photo("new2", "f2", 0), photo("new3", "f3", 0)];
    const plan = buildWeekPlan(input({ photos, projects: [], config: { ...DEFAULT_CONFIG, postsPerWeek: 4, connectionIds: [] }, connections: [conn("c-ig", "instagram"), conn("c-fb", "facebook")] }));
    const covers = plan.groups.flatMap((g) => (g.photos[0] && !g.photos[0].fromProject ? [g.photos[0].path] : []));
    expect(new Set(covers).size).toBe(covers.length);
    expect(covers.slice(0, 3).every((p) => p.includes("new"))).toBe(true);
  });

  it("only hands JPG and PNG photos to templates", () => {
    const photos = [photo("a", null, 0, "image/webp"), photo("b", null, 1, "image/png")];
    const plan = buildWeekPlan(input({ photos, projects: [], config: { ...DEFAULT_CONFIG, postsPerWeek: 3, connectionIds: [] }, connections: [conn("c-ig", "instagram")] }));
    for (const g of plan.groups) if (g.photos[0] && !g.photos[0].fromProject) expect(g.photos[0].mimeType).toMatch(/jpeg|png/);
  });

  it("downgrades a carousel to a single image when there are not two pictures", () => {
    const plan = buildWeekPlan(input({ photos: [], projects: [project("p", "product")], connections: [conn("c-ig", "instagram")], config: { ...DEFAULT_CONFIG, postsPerWeek: 6, connectionIds: [] } }));
    for (const g of plan.groups) for (const p of g.posts) expect(p.format).not.toBe("CAROUSEL");
  });

  it("keeps a carousel when a project has several photos", () => {
    const projects = [project("listing", "listing", { photoPaths: ["u/projects/1.jpg", "u/projects/2.jpg", "u/projects/3.jpg"] })];
    const found = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].some((seed) =>
      buildWeekPlan(input({ businessId: seed, projects, industryTags: ["realestate"], connections: [conn("c-ig", "instagram")], config: { ...DEFAULT_CONFIG, postsPerWeek: 6, connectionIds: [] } })).groups.some((g) => g.posts.some((p) => p.format === "CAROUSEL" && g.photos.length >= 2)),
    );
    expect(found).toBe(true);
  });
});

describe("one app per idea (content packs)", () => {
  it("puts each idea on one account, and every account gets one before any gets two", () => {
    const connections = [conn("c-ig", "instagram"), conn("c-fb", "facebook"), conn("c-li", "linkedin")];
    const plan = buildWeekPlan(input({ connections, config: { ...DEFAULT_CONFIG, postsPerWeek: 5, connectionIds: [] } }));
    expect(plan.groups.length).toBeGreaterThanOrEqual(3);
    expect(plan.groups.every((g) => g.posts.length === 1 && g.networks.length === 1)).toBe(true);
    const perAccount = new Map<string, number>();
    for (const g of plan.groups) perAccount.set(g.posts[0].connectionId, (perAccount.get(g.posts[0].connectionId) ?? 0) + 1);
    expect([...perAccount.keys()].sort()).toEqual(["c-fb", "c-ig", "c-li"]);
    expect(Math.max(...perAccount.values()) - Math.min(...perAccount.values())).toBeLessThanOrEqual(1);
  });
});

describe("posts per app per day count what is already there", () => {
  it("a product that already has its post on an app that day gets no second one from Autopilot", () => {
    const connections = [conn("c-ig", "instagram")];
    const base = input({ connections, projects: [project("p1", "product")], config: { ...DEFAULT_CONFIG, postsPerWeek: 7, connectionIds: [] } });
    const free = buildWeekPlan(base);
    const busy = free.groups.find((g) => g.project?.id === "p1")!;
    const plan = buildWeekPlan({ ...base, existing: [{ connectionId: null, scheduledAt: busy.posts[0].scheduledAt, network: "instagram", subjectId: "p1" }] });
    expect(plan.groups.some((g) => g.project?.id === "p1" && g.day === busy.day)).toBe(false);
    expect(plan.notes.join(" ")).toMatch(/per app a day/);
  });
});
