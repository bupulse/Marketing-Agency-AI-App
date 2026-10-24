import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const findMany = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { trainingExample: { findMany: (...a: unknown[]) => findMany(...a) } } }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));

import { fixWrittenSpellings } from "@/lib/autopilot/writer";
import { fixWrittenPosts } from "@/lib/content-flow/post-writing";
import { fixImageWords, labBlock } from "@/lib/image-engine/prompter";
import { labBlock as reelLabBlock } from "@/lib/reel-engine/writer";
import { OTHER_BUSINESSES_NOTE, PLACEHOLDER_NOTE, dropPlaceholderSentences, fixSpellings, polishReelTexts } from "@/lib/training-lab/fix-spelling";
import { labLanguage } from "@/lib/training-lab/language-reader";

const extra = { wrong: [{ word: "beauty", fix: "beaute" }, { word: "igiciro", fix: "igiciro:" }] };

describe("fixSpellings leaves these alone", () => {
  it("links, emails, hashtags and @handles", () => {
    const text = "Visit www.igiciro.rw or https://x.rw/igiciro, mail igiciro@x.rw, #igiciro, (#Beauty) and @beauty. Igiciro";
    expect(fixSpellings(text, extra).text).toBe("Visit www.igiciro.rw or https://x.rw/igiciro, mail igiciro@x.rw, #igiciro, (#Beauty) and @beauty. Igiciro:");
  });
  it("a word inside a longer one joined by - . or /", () => {
    expect(fixSpellings("Nez-Beauty, beauty-shop, a/beauty, x.beauty.y and Beauty.", extra).text).toBe("Nez-Beauty, beauty-shop, a/beauty, x.beauty.y and Beaute.");
  });
  it("the names given to protect, wherever they appear", () => {
    expect(fixSpellings("Beauty Corner sells beauty. Visit Beauty Corner", extra, ["Beauty Corner"]).text).toBe("Beauty Corner sells beaute. Visit Beauty Corner");
    expect(fixSpellings("igiciro", extra, [null, undefined, "", "x"]).text).toBe("igiciro:");
  });
  it("still fixes a plain word at the end of a sentence or before a comma", () => {
    expect(fixSpellings("Igiciro. igiciro, igiciro!", extra).text).toBe("Igiciro:. igiciro:, igiciro:!");
  });
});

describe("dropPlaceholderSentences", () => {
  it("drops each sentence that has a hidden detail, keeps the rest and the lines", () => {
    expect(dropPlaceholderSentences("Fresh greens. Only {price} today! Call {phone}.\nSecond line {email}\n[Logo] Ask us.")).toBe("Fresh greens.\n\n[Logo] Ask us.");
    expect(dropPlaceholderSentences("Visit {website}")).toBe("");
  });
  it("leaves other text and other braces alone", () => {
    expect(dropPlaceholderSentences("Nothing to see. {note}")).toBe("Nothing to see. {note}");
  });
});

describe("every writer's fix step takes protect and drops placeholders", () => {
  it("reel texts", () => {
    const out = polishReelTexts({ title: "Beauty Corner", caption: "Igiciro {price}. Murakaza", clips: [{ line: "Beauty igiciro" }] }, "Kinyarwanda", extra, ["Beauty Corner"]);
    expect(out.plan.title).toBe("Beauty Corner");
    expect(out.plan.caption).toBe("Murakaza");
    expect(out.plan.clips[0].line).toBe("Beaute igiciro:");
  });
  it("image words and captions", () => {
    const concept = { title: "t", scene: "s", headline: "Beauty Corner igiciro", subline: "Call {phone}", cta: "Beauty", prompt: "p" };
    const out = fixImageWords([concept], ["Igiciro. Only {price}"], extra, ["Beauty Corner"]);
    expect(out.concepts[0]).toMatchObject({ headline: "Beauty Corner igiciro:", subline: "", cta: "Beaute" });
    expect(out.captions).toEqual(["Igiciro:."]);
  });
  it("pack posts", () => {
    const [p] = fixWrittenPosts([{ caption: "Beauty Corner igiciro {price}. Come", videoScript: "x", adHeadlines: ["Beauty", "Call {phone}"] }], extra, ["Beauty Corner"]);
    expect(p).toEqual({ caption: "Come", videoScript: "x", adHeadlines: ["Beaute", ""] });
  });
  it("autopilot posts: the same object when nothing changes, a copy when it does", () => {
    const written = { image: { kicker: "", headline: "Plain", subline: "", chip: "" }, versions: [{ network: "instagram", text: "Hello", title: null, hashtags: [] }] } as never;
    expect(fixWrittenSpellings(written, extra, ["Nez"])).toBe(written);
    const dirty = { image: { kicker: "", headline: "Plain", subline: "", chip: "" }, versions: [{ network: "instagram", text: "Beauty Nez. Only {price}", title: null, hashtags: [] }] } as never;
    const out = fixWrittenSpellings(dirty, extra, ["Beauty Nez"]) as { versions: { text: string }[] };
    expect(out.versions[0].text).toBe("Beauty Nez.");
  });
});

describe("the Lab block", () => {
  const lab = { examples: ["Image: x"], avoid: ["Never: y"], phrases: ["Murakaza neza"] };
  it("tells the writer about hidden details under the examples, and about other businesses under the phrases", () => {
    for (const block of [labBlock(lab, "Kinyarwanda"), reelLabBlock(lab, "Kinyarwanda")]) {
      expect(block).toContain(`never copy their words or numbers):\n${OTHER_BUSINESSES_NOTE} ${PLACEHOLDER_NOTE}\n- Image: x`);
      expect(block).toContain(`(spelling and natural phrases):\n${OTHER_BUSINESSES_NOTE}\n- Murakaza neza`);
    }
  });
  it("is nothing when the Lab is empty", () => {
    expect(labBlock({ examples: [], avoid: [], phrases: [] }, "Kinyarwanda")).toBeNull();
    expect(reelLabBlock({ examples: [], avoid: [], phrases: [] }, "Kinyarwanda")).toBeNull();
  });
});

describe("labLanguage and recordings with no language", () => {
  const row = (language: string | null, transcript: string) => ({ kind: "voice", rating: null, transcript, notes: null, engines: ["language"], language });
  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([row(null, "murakaza neza"), row("English", "welcome home"), row("Kinyarwanda", "muraho")]);
  });
  it("counts them for Kinyarwanda businesses only", async () => {
    expect((await labLanguage("Kinyarwanda")).words).toEqual(["murakaza", "neza", "muraho"]);
    expect((await labLanguage("English")).words).toEqual(["welcome", "home"]);
    expect((await labLanguage("French")).words).toBeUndefined();
  });
  it("counts all of them when no language is asked for", async () => {
    expect((await labLanguage()).words).toHaveLength(5);
  });
});
