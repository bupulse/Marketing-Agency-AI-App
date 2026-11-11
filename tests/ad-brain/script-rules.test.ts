import { describe, expect, it } from "vitest";
import { checkScript, clipSecondsFor, hasMoneyWords, looksKinyarwanda, mentionsSite, speakable, wordCount, type Script, type ScriptContext } from "@/lib/ad-brain/script-rules";
import { recipeById } from "@/lib/ad-brain/recipes";

const recipe = recipeById("testimonial_screens")!;
const ctx: ScriptContext = {
  brandName: "BuPulse",
  url: "bupulse.com",
  facts: "BuPulse writes a week of posts, designs them in your brand and posts them on every network. Posts in Kinyarwanda.",
  beats: recipe.beats.map((b) => ({ id: b.id, speech: b.speech, titleWords: b.titleWords, screens: b.screens })),
  screenIds: ["posts-week", "cards", "calendar", "home"],
};

const good = (): Script => ({
  characters: [{ id: "amani", gender: "man", look: "A Rwandan man, late 20s, in a Kigali flat" }],
  beats: [
    { beat: "hook", line: { speaker: "amani", text: "I stopped writing my own Instagram posts.", source: "omni" }, title: "I STOPPED POSTING" },
    { beat: "montage", screens: [{ id: "posts-week", title: "A WEEK OF POSTS" }, { id: "cards", title: "WRITTEN FOR YOU" }, { id: "calendar", title: "POSTED ON TIME" }] },
    { beat: "benefit", line: { speaker: "amani", text: "It writes, designs and posts my whole week.", source: "omni" } },
  ],
  cta: { speaker: "amani", text: "Check out BuPulse dot com and get a free quote.", source: "tts" },
  caption: "My posts write themselves now.",
  hashtags: ["BuPulse", "Kigali"],
  endCard: { headline: "Your week of posts, done", button: "Get a free quote", sub: "" },
});

describe("the script rules", () => {
  it("accept a script that keeps every rule", () => {
    expect(checkScript(good(), ctx)).toEqual([]);
  });

  it("never open with the brand", () => {
    const s = good();
    s.beats[0].line!.text = "BuPulse is the best marketing app.";
    expect(checkScript(s, ctx).join(" ")).toMatch(/opens with the brand name/);
  });

  it("keep AI clip lines within 25 words and without money words", () => {
    const s = good();
    s.beats[2].line!.text = Array.from({ length: 30 }, () => "word").join(" ");
    expect(checkScript(s, ctx).join(" ")).toMatch(/has 30 words; an AI clip holds at most 25/);
    const t = good();
    t.beats[2].line!.text = "And the first week is free.";
    expect(checkScript(t, ctx).join(" ")).toMatch(/money words/);
  });

  it("need a spoken call to action that names the site", () => {
    const s = good();
    s.cta.text = "Try it now.";
    expect(checkScript(s, ctx).join(" ")).toMatch(/must say where to go/);
  });

  it("refuse Kinyarwanda AI speech and invented numbers", () => {
    const s = good();
    s.beats[2].line!.text = "Muraho, ubucuruzi bwawe buzamuka cyane.";
    expect(checkScript(s, ctx).join(" ")).toMatch(/in Kinyarwanda/);
    const t = good();
    t.beats[0].line!.text = "My sales went up 300% in a week.";
    expect(checkScript(t, ctx).join(" ")).toMatch(/"300%" is a number that is not in the business's facts/);
  });

  it("need the recipe's beats, real screens and short titles", () => {
    const s = good();
    s.beats = s.beats.filter((b) => b.beat !== "benefit");
    expect(checkScript(s, ctx).join(" ")).toMatch(/Beat "benefit" is missing/);
    const t = good();
    t.beats[1].screens = [{ id: "fake-screen", title: "X" }];
    expect(checkScript(t, ctx).join(" ")).toMatch(/at least 3 real screens|"fake-screen" is not one of the real captures/);
    const u = good();
    u.beats[0].title = "ONE TWO THREE FOUR FIVE SIX SEVEN";
    expect(checkScript(u, ctx).join(" ")).toMatch(/at most 5/);
  });

  it("size clips to the line and read the brand the way it sounds", () => {
    expect(wordCount("One of these was made by AI.")).toBe(7);
    expect(clipSecondsFor("Like this.")).toBe(3);
    expect(clipSecondsFor(Array.from({ length: 40 }, () => "w").join(" "))).toBe(10);
    expect(speakable("Check out BuPulse.com today", "tts")).toBe("Check out Boo Pulse dot com today");
    expect(speakable("Say excitedly: Check out BuPulse", "tts")).toBe("Check out Boo Pulse");
    expect(speakable("Check out BuPulse dot com", "omni")).toBe("Check out BuPulse dot com");
  });

  it("recognise money words, Kinyarwanda and the site", () => {
    expect(hasMoneyWords("Get a free quote")).toBe(true);
    expect(hasMoneyWords("Only 5,000 RWF")).toBe(true);
    expect(hasMoneyWords("It writes my whole week")).toBe(false);
    expect(looksKinyarwanda("Muraho neza, murakoze")).toBe(true);
    expect(looksKinyarwanda("Murakoze")).toBe(false);
    expect(mentionsSite("Go to Boo Pulse dot com", "bupulse.com")).toBe(true);
    expect(mentionsSite("Visit bupulse.com", "https://bupulse.com/")).toBe(true);
    expect(mentionsSite("Download the app", "bupulse.com")).toBe(false);
  });
});
