import { describe, expect, it } from "vitest";
import { validateEdl, type Edl } from "@/lib/ad-brain/edl";
import { twistFixture } from "@/lib/ad-brain/fixtures";

const clone = (e: Edl): Edl => JSON.parse(JSON.stringify(e));
const errorsOf = (e: unknown) => validateEdl(e).errors.join(" | ");

describe("the EDL check", () => {
  it("passes the 10 November twist ad", () => {
    const r = validateEdl(twistFixture());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.edl?.canvas.seconds).toBe(30);
  });

  it("refuses a malformed plan with readable messages", () => {
    const r = validateEdl({ version: 1, segments: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("finds gaps, overlaps and a wrong length", () => {
    const e = clone(twistFixture());
    e.segments[1].start += 0.5;
    expect(errorsOf(e)).toMatch(/starts at 6\.68 s, but the one before ends at 6\.18 s/);
    const f = clone(twistFixture());
    f.canvas.seconds = 31;
    expect(errorsOf(f)).toMatch(/segments end at 30\.00 s, but the ad is 31\.00 s/);
    const g = clone(twistFixture());
    g.canvas.seconds = 50;
    expect(errorsOf(g)).toMatch(/must be 20 to 34 s/);
  });

  it("hard rule 1: a screen on camera must be a real capture", () => {
    const e = clone(twistFixture());
    delete e.assets["screen:home"].capture;
    expect(errorsOf(e)).toMatch(/not a real capture/);
    const f = clone(twistFixture());
    f.segments[4].asset = "clip:hook"; // a real_screen segment pointing at an AI clip
    expect(errorsOf(f)).toMatch(/cannot show a video/);
  });

  it("hard rule 2: a spoken call to action, last, near the end, naming the site", () => {
    const e = clone(twistFixture());
    e.voice = e.voice.filter((v) => !v.cta);
    expect(errorsOf(e)).toMatch(/no spoken call to action/);
    const f = clone(twistFixture());
    f.voice.find((v) => v.cta)!.text = "Try it today.";
    expect(errorsOf(f)).toMatch(/does not say where to go/);
    const g = clone(twistFixture());
    const cta = g.voice.find((v) => v.cta)!;
    cta.at = 2;
    expect(errorsOf(g)).toMatch(/must be the last line|in the last 8 s/);
  });

  it("hard rule 3: no AI Kinyarwanda voice; money words in Omni speech only warn", () => {
    const e = clone(twistFixture());
    e.voice[0].language = "rw";
    expect(errorsOf(e)).toMatch(/Kinyarwanda needs a real recorded voice/);
    const f = clone(twistFixture());
    f.voice[0].text = "Get it free today";
    // Money words in Omni speech are allowed now (with the TTS fallback): a warning, not an error.
    expect(errorsOf(f)).not.toMatch(/money words/);
    expect(validateEdl(f).warnings.join(" ")).toMatch(/money words/);
    const g = clone(twistFixture());
    g.voice[4].text = "Check out BuPulse dot com and get a free quote."; // TTS may say "free"
    expect(validateEdl(g).ok).toBe(true);
  });

  it("hard rule 5: no burned-in AI watermark", () => {
    const e = clone(twistFixture());
    e.titles[0].text = "AI-GENERATED";
    expect(errorsOf(e)).toMatch(/AI watermark/);
  });

  it("hard rule 7: the music stays under the voices", () => {
    const e = clone(twistFixture());
    e.music!.gainDb = -2;
    e.music!.duckDb = 6;
    expect(errorsOf(e)).toMatch(/at least 12 dB below/);
    const f = clone(twistFixture());
    f.music!.duckDb = 3;
    expect(errorsOf(f)).toMatch(/dip at least 6 dB/);
  });

  it("checks effects: known, drawn where they fit, sane settings, signature ones used", () => {
    const e = clone(twistFixture());
    e.segments[0].effects = [{ id: "teleport", params: {} }];
    expect(errorsOf(e)).toMatch(/"teleport" is not an effect/);
    const f = clone(twistFixture());
    f.segments[0].effects = [{ id: "rgb_split", params: { amount: 99 } }];
    expect(errorsOf(f)).toMatch(/amount must be a number from 2 to 30/);
    const g = clone(twistFixture());
    g.segments[0].effects = [{ id: "freeze_frame", params: {} }, { id: "browser_window", params: {} }];
    expect(errorsOf(g)).toMatch(/"browser_window" cannot be drawn on a ai_clip/);
    const h = clone(twistFixture());
    h.effects = ["scan_wipe", "robot_voice", "whip_pan"];
    expect(errorsOf(h)).toMatch(/"whip_pan" is not used anywhere/);
    const i = clone(twistFixture());
    delete i.assets["screen:approve"].tap;
    expect(errorsOf(i)).toMatch(/tap ripple needs the real button/);
  });
});
