import { describe, expect, it, vi } from "vitest";
import { checkSeedanceConnection, type SeedanceRequest } from "@/lib/video-engine/seedance";
import {
  BUSINESS_KINDS,
  CAMERA_LANGUAGE,
  SEEDANCE_FORMATS,
  SEEDANCE_TEMPLATES,
  SHOT_TYPES,
  checkSeedanceRequest,
  detectBusinessKind,
  detectCamera,
  lintSeedancePrompt,
  pickSeedanceTemplate,
  planSeedanceShots,
  promptTimecodes,
  type SeedanceBrief,
} from "@/lib/video-engine/seedance-brain";
import { SEEDANCE_SYSTEM, promptBriefText, writeSeedancePrompt } from "@/lib/video-engine/seedance-prompt";

const phone: SeedanceBrief = {
  business: { name: "Nova Phones Kigali", description: "Phones and accessories in Kigali", language: "English", country: "Rwanda" },
  product: { name: "Galaxy A56", price: "420,000 RWF", usps: ["Big 5000 mAh battery"] },
  references: ["Image 1: the phone on a stand"],
  seconds: 8,
  ratio: "9:16",
  audio: true,
};

describe("seedance brain catalogue", () => {
  it("has 20+ templates covering every business kind and format, with known shot and camera words", () => {
    expect(SEEDANCE_TEMPLATES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(SEEDANCE_TEMPLATES.map((t) => t.id)).size).toBe(SEEDANCE_TEMPLATES.length);
    for (const k of BUSINESS_KINDS) expect(SEEDANCE_TEMPLATES.some((t) => t.business.includes(k.id)), k.id).toBe(true);
    for (const f of SEEDANCE_FORMATS) expect(SEEDANCE_TEMPLATES.some((t) => t.format === f.id), f.id).toBe(true);
    for (const t of SEEDANCE_TEMPLATES) {
      for (const b of t.beats) {
        expect(SHOT_TYPES.some((s) => s.id === b.shot), `${t.id} ${b.shot}`).toBe(true);
        expect(CAMERA_LANGUAGE.some((c) => c.id === b.camera), `${t.id} ${b.camera}`).toBe(true);
        // No prices or business names in what is filmed: the video has no text.
        expect(b.action).not.toMatch(/\{(price|business|usp)\}/);
      }
      expect(t.beats.at(-1)?.say?.length ?? 0, `${t.id} ends with a line`).toBeGreaterThan(0);
    }
  });

  it("reads camera words back (the storyboard relies on it)", () => {
    for (const c of CAMERA_LANGUAGE) expect(detectCamera(c.words)?.id, c.id).toBe(c.id);
  });

  it("detects the business kind and picks a fitting template", () => {
    expect(detectBusinessKind(phone)).toBe("phone-shop");
    expect(detectBusinessKind({ business: { name: "Inzozi Salon", description: "Braids and hair care" }, product: { name: "Knotless braids" } })).toBe("salon");
    expect(detectBusinessKind({ business: { name: "Kibagabaga Homes" }, product: { name: "3-bedroom house for rent" } })).toBe("real-estate");
    expect(detectBusinessKind({ business: { name: "Duka" }, product: { name: "Soap" } })).toBe("shop");
    // The product decides before the business: a cleaning service from a real-estate agency, a growing kit from a food business.
    expect(detectBusinessKind({ business: { name: "Urugo Homes", description: "We sell and rent houses" }, product: { name: "Home cleaning after moving in" } })).toBe("services");
    expect(detectBusinessKind({ business: { name: "Green Kit", description: "Grow healthy food" }, product: { name: "Vertical Hydroponic Growing System" } })).toBe("shop");
    expect(pickSeedanceTemplate({ ...phone, templateId: "ugc-unboxing" }).id).toBe("phone-unboxing");
    expect(pickSeedanceTemplate({ ...phone, templateId: "salon-transformation" }).id).toBe("salon-transformation");
    expect(pickSeedanceTemplate({ ...phone, businessKind: "education", format: "unboxing" }).id).toBe("any-unboxing");
  });
});

describe("planSeedanceShots", () => {
  it("fills a template: time codes add up, the product keeps its photo, only real facts are spoken", () => {
    const plan = planSeedanceShots({ ...phone, templateId: "phone-hero" });
    expect(plan.templateId).toBe("phone-hero");
    expect(plan.shots[0].from).toBe(0);
    expect(plan.shots.at(-1)?.to).toBe(8);
    for (let i = 1; i < plan.shots.length; i++) expect(plan.shots[i].from).toBe(plan.shots[i - 1].to);
    expect(plan.prompt.match(/must look exactly as in Image 1/g)).toHaveLength(1);
    expect(plan.prompt).toContain("Galaxy A56 from Image 1");
    expect(plan.prompt).toContain('"Galaxy A56: 420,000 RWF."');
    expect(plan.prompt).toContain("no on-screen text");
    expect(plan.prompt).not.toContain("Nova Phones Kigali, a"); // the name is spoken, never filmed
    expect(lintSeedancePrompt(plan.prompt, { seconds: 8, images: 1, videos: 0, audios: 0, audio: true }).filter((i) => i.level !== "info")).toEqual([]);
  });

  it("every template passes its own rules at every length", () => {
    for (const t of SEEDANCE_TEMPLATES) {
      for (const seconds of [4, 5, 8, 10, 12, 15]) {
        const plan = planSeedanceShots({ ...phone, templateId: t.id, seconds });
        expect(promptTimecodes(plan.prompt).at(-1)?.[1], `${t.id} ${seconds}`).toBe(seconds);
        expect(plan.shots.length).toBeLessThanOrEqual(Math.max(2, Math.floor(seconds / 2)));
        const issues = lintSeedancePrompt(plan.prompt, { seconds, images: 1, videos: 0, audios: 0, audio: true }).filter((i) => i.level !== "info");
        expect(issues, `${t.id} ${seconds}`).toEqual([]);
        expect(plan.words).toBeLessThan(300);
      }
    }
  });

  it("never speaks a price with conditions, shortens long names, and treats every house photo as the place", () => {
    const kit = planSeedanceShots({ ...phone, product: { name: "Green Tower – Vertical Growing Kit", price: "90,000 RWF (depends on the size)" }, templateId: "shop-offer" });
    expect(kit.prompt).not.toContain("90,000");
    expect(kit.notes.join(" ")).toMatch(/price has conditions/);
    expect(kit.prompt).toContain("The Green Tower – Vertical Growing Kit must look exactly as in Image 1");
    expect(kit.prompt).toContain("the Green Tower from Image 1");
    const house = planSeedanceShots({ business: { name: "Homes" }, product: { name: "3-bedroom house with garden, Kibagabaga" }, references: ["Image 1: photo of the house", "Image 2: photo of the house"], format: "tour", seconds: 12 });
    expect(house.prompt).toContain("(Image 2 shows more of it)");
    expect(house.prompt).not.toContain("logo and label");
  });

  it("speaks no price that is not given, French for French businesses, nothing in Kinyarwanda", () => {
    const noPrice = planSeedanceShots({ ...phone, product: { name: "Galaxy A56" }, templateId: "phone-offer" });
    expect(noPrice.prompt).not.toMatch(/RWF|\d{3},\d{3}/);
    expect(noPrice.notes.join(" ")).toMatch(/No price/);
    const fr = planSeedanceShots({ ...phone, business: { ...phone.business, language: "French" }, templateId: "phone-unboxing" });
    expect(fr.prompt).toMatch(/in French: "/);
    const rw = planSeedanceShots({ ...phone, business: { ...phone.business, language: "Kinyarwanda" } });
    expect(rw.prompt).not.toContain('"');
    expect(rw.notes.join(" ")).toMatch(/ElevenLabs/);
    const silent = planSeedanceShots({ ...phone, audio: false });
    expect(silent.prompt).not.toMatch(/Sound:|Music:|"/);
  });

  it("respects a fixed lens, uses the house photo as the place, and warns about faces and missing photos", () => {
    const still = planSeedanceShots({ ...phone, fixedLens: true, templateId: "phone-hero" });
    expect(still.shots.every((s) => s.camera === "locked-off static camera")).toBe(true);
    expect(lintSeedancePrompt(still.prompt, { seconds: 8, images: 1, videos: 0, audios: 0, fixedLens: true }).some((i) => i.code === "fixed-lens-moves")).toBe(false);
    const house = planSeedanceShots({ business: { name: "Kibagabaga Homes" }, product: { name: "3-bedroom house" }, references: ["Image 1: front of the house"], seconds: 15, format: "tour" });
    expect(house.templateId).toBe("realestate-tour");
    expect(house.prompt).toContain("the place in Image 1");
    const presenter = planSeedanceShots({ ...phone, references: ["Image 1: the phone", "Image 2: Aline (AI presenter) holding the phone"], templateId: "phone-ugc-review" });
    expect(presenter.prompt).toContain("presenter from Image 2");
    expect(presenter.notes.join(" ")).toMatch(/refuses photos with real-looking faces/);
    const noPhoto = planSeedanceShots({ ...phone, references: [] });
    expect(noPhoto.notes.join(" ")).toMatch(/No product photo/);
    expect(noPhoto.prompt).not.toContain("Image");
  });
});

describe("checkSeedanceRequest", () => {
  const base: SeedanceRequest = { tier: "fast", prompt: planSeedanceShots(phone).prompt, references: [{ kind: "image", url: "data:image/jpeg;base64,AAAA" }], ratio: "9:16", seconds: 8, resolution: "720p", audio: true, fixedLens: false, seed: null };
  const codes = (r: Partial<SeedanceRequest>, notes?: string[]) => checkSeedanceRequest({ ...base, ...r }, { referenceNotes: notes }).issues.map((i) => `${i.level}:${i.code}`);

  it("passes a good request and prices it", () => {
    const out = checkSeedanceRequest(base, { referenceNotes: ["Image 1: the phone on a stand"] });
    expect(out.ok).toBe(true);
    expect(out.issues.filter((i) => i.level !== "info")).toEqual([]);
    expect(out.estimateUsd).toBeCloseTo(0.96);
  });

  it("explains what BytePlus will refuse, before we pay", () => {
    expect(codes({ resolution: "1080p" })).toContain("error:resolution");
    expect(codes({ resolution: "1080p", draft: true })).toContain("warning:draft-resolution");
    expect(codes({ seconds: 20 })).toContain("warning:seconds");
    expect(codes({ references: Array.from({ length: 10 }, () => ({ kind: "image" as const, url: "data:image/jpeg;base64,AA" })) })).toContain("error:too-many-images");
    expect(codes({ prompt: "0-4s: the phone from Image 3 turns. 4-8s: hero shot." })).toContain("error:reference-missing");
    expect(codes({ references: [{ kind: "audio", url: "data:audio/mpeg;base64,AA" }], prompt: "0-8s: music from Audio 1 plays over a slow orbit of the phone." })).toContain("error:audio-alone");
    expect(codes({ references: [{ kind: "image", url: "data:image/jpeg;base64,AA", role: "last_frame" }] })).toContain("error:last-without-first");
    expect(codes({ ratio: "4:5" as SeedanceRequest["ratio"] })).toContain("error:ratio");
    expect(codes({ seed: 1.5 })).toContain("error:seed");
    expect(codes({ prompt: "" })).toContain("error:prompt-empty");
    expect(checkSeedanceRequest({ ...base, resolution: "1080p" }).ok).toBe(false);
  });

  it("warns about faces it cannot see, text in the video and contradictions", () => {
    expect(codes({}, ["Image 1: Aline (AI presenter) holding the phone"])).toContain("warning:faces");
    expect(codes({}, ["Image 1: the phone"])).toContain("info:faces-unchecked");
    expect(codes({ prompt: `${base.prompt}\nShow the caption "NEW" on screen.` })).toContain("warning:on-screen-text");
    expect(codes({ fixedLens: true, prompt: "0-4s: slow orbit around the phone from Image 1. 4-8s: push in on it." })).toContain("warning:fixed-lens-moves");
    expect(codes({ audio: false })).toContain("warning:speech-without-sound");
  });
});

describe("seedance prompt writer uses the brain", () => {
  const brief = { ...phone, references: phone.references ?? [], templateId: "ugc-review", seconds: 8, ratio: "9:16", audio: true, presenter: null };

  it("the system prompt carries the rules and camera words; the brief carries a starting plan", () => {
    expect(SEEDANCE_SYSTEM).toContain("No invented prices");
    expect(SEEDANCE_SYSTEM).toContain("slow orbit around the subject");
    expect(SEEDANCE_SYSTEM).toContain("Kinyarwanda");
    const text = promptBriefText(brief);
    expect(text).toContain("Customer review");
    expect(text).toContain("Starting shot plan");
    expect(text).toMatch(/0-\d+s: /);
  });

  it("carries the research Brain's context as a fenced block, before the starting plan", () => {
    const text = promptBriefText({ ...brief, platform: "tiktok", business: { ...brief.business, phone: "0788 000 000" } });
    const block = text.match(/<<<RESEARCH\n([\s\S]*?)\nRESEARCH>>>/)?.[1] ?? "";
    expect(block).toMatch(/Hook options/);
    expect(block).toMatch(/\n1\. [^\n]+: "/); // a hook with its pattern
    expect(block).toMatch(/Shots and sound:\n- \S/); // a rule
    expect(block).toMatch(/TikTok/i);
    expect(block).not.toMatch(/<<<|>>>/);
    expect(text.indexOf("RESEARCH>>>")).toBeLessThan(text.indexOf("Starting shot plan"));
    expect(text).toMatch(/guidance only, not text to copy/);
    expect(SEEDANCE_SYSTEM).toContain("Follow the research block");
    expect(SEEDANCE_SYSTEM).toMatch(/not text to copy: the prompt stays 60 to 160 words/);
    // No platform: still a research block, for any platform.
    expect(promptBriefText(brief)).toContain("<<<RESEARCH");
  });

  it("falls back to the plan when Claude is unavailable, and lints Claude's answer", async () => {
    const down = vi.fn(async () => {
      throw new Error("CLI not logged in");
    });
    const out = await writeSeedancePrompt(brief, down, "m");
    expect(out.fallback).toMatch(/Claude was unavailable/);
    expect(out.prompt).toMatch(/^A vertical 9:16/);
    expect(out.usage.costUsd).toBe(0);
    const ok = vi.fn(async () => ({ text: "0-4s: the phone from Image 2 spins. 4-8s: hero shot.", usage: { model: "m", inputTokens: 1, outputTokens: 1, costUsd: 0.001 }, stop: "end_turn" }));
    const linted = await writeSeedancePrompt(brief, ok, "m");
    expect(linted.issues.map((i) => i.code)).toContain("reference-missing");
  });
});

describe("checkSeedanceConnection", () => {
  const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  const run = (f: ReturnType<typeof reply>) => checkSeedanceConnection({ apiKey: "k", fetchImpl: f as unknown as typeof fetch });

  it("lists one task with the key and reports connected", async () => {
    const f = reply({ items: [], total: 3 });
    const out = await run(f);
    expect(out.state).toBe("connected");
    expect(out.message).toContain("3 video tasks");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/contents\/generations\/tasks\?page_num=1&page_size=1$/);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
  });

  it("says key invalid, not activated or unreachable in plain English", async () => {
    expect((await run(reply({ error: { code: "AuthenticationError", type: "Unauthorized" } }, 401))).state).toBe("key invalid");
    expect((await run(reply({ error: { code: "ModelNotOpen" } }, 404))).state).toBe("not activated");
    expect((await run(reply({ error: { code: "AccountOverdueError" } }, 403))).message).toMatch(/balance/);
    expect((await run(reply({ error: { code: "AccessDenied" } }, 403))).state).toBe("not activated");
    expect((await run(reply({}, 404))).state).toBe("unreachable");
    expect((await run(reply({}, 503))).state).toBe("unreachable");
    const offline = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });
    expect((await checkSeedanceConnection({ apiKey: "k", fetchImpl: offline as unknown as typeof fetch })).state).toBe("unreachable");
    expect((await checkSeedanceConnection({ apiKey: " " })).state).toBe("no key");
  });
});
