import { describe, expect, it } from "vitest";
import { creditLine, licenceNeedsCredit, stripMusicCredit, trackCredit, withCredit } from "@/lib/music/credit";
import { ELEVENLABS_MUSIC_LICENCE } from "@/lib/music/tracks";

// Music credit lines (owner, 11 November 2026): CC BY tracks are credited on every post that carries the reel.

const INCOMPETECH = { title: "Allada", licence: "CC BY 4.0", attribution: "Allada, Kevin MacLeod (incompetech.com), CC BY 4.0", sourceUrl: "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100000" };

describe("which tracks are credited", () => {
  it("CC BY (4.0, 3.0) and other licences that ask for it are; BuPulse's own music, Pixabay and CC0 are not", () => {
    expect(licenceNeedsCredit("CC BY 4.0")).toBe(true);
    expect(licenceNeedsCredit("Creative Commons Attribution 3.0 (CC BY 3.0)")).toBe(true);
    expect(licenceNeedsCredit(ELEVENLABS_MUSIC_LICENCE)).toBe(false);
    expect(licenceNeedsCredit("Pixabay Content License")).toBe(false);
    expect(licenceNeedsCredit("CC0 1.0")).toBe(false);
    expect(licenceNeedsCredit("Public Domain")).toBe(false);
    expect(licenceNeedsCredit("")).toBe(false);
  });

  it("the credit line: 'Music: <attribution>'; without one written, the title, source and licence", () => {
    expect(trackCredit(INCOMPETECH)).toBe("Music: Allada, Kevin MacLeod (incompetech.com), CC BY 4.0");
    expect(trackCredit({ ...INCOMPETECH, attribution: "Music: Allada by Kevin MacLeod" })).toBe("Music: Allada by Kevin MacLeod");
    expect(trackCredit({ title: "Night Walk", licence: "CC BY 3.0", attribution: "", sourceUrl: "https://freemusicarchive.org/music/x" })).toBe("Music: Night Walk, (https://freemusicarchive.org/music/x), CC BY 3.0");
    expect(trackCredit({ title: "Morning", licence: "Pixabay Content License", attribution: "Music: Morning (Pixabay)" })).toBeNull();
    expect(creditLine("  ")).toBe("");
  });
});

describe("chosen with the reel's music", () => {
  it("the video's music carries its credit (trackForVideo, a music swap), null for music that needs none", async () => {
    const { videoMusicOf } = await import("@/lib/music/service");
    expect(videoMusicOf({ id: "t1", path: "t1.mp3", ...INCOMPETECH })).toMatchObject({ trackId: "t1", owned: false, credit: "Music: Allada, Kevin MacLeod (incompetech.com), CC BY 4.0" });
    expect(videoMusicOf({ id: "t2", title: "Kigali Morning", path: "t2.mp3", attribution: "", licence: ELEVENLABS_MUSIC_LICENCE })).toMatchObject({ owned: true, credit: null });
  });
});

describe("the credit in a caption", () => {
  const credit = "Music: Allada, Kevin MacLeod (incompetech.com), CC BY 4.0";

  it("is the last line, after a blank line, and never added twice", () => {
    const once = withCredit("Fresh greens at school 🌱", credit);
    expect(once).toBe(`Fresh greens at school 🌱\n\n${credit}`);
    expect(withCredit(once, credit)).toBe(once);
  });

  it("a music swap replaces the old credit; music that needs none takes it off", () => {
    const old = `Fresh greens\n\nMusic: Old Song, Someone (example.org), CC BY 3.0`;
    expect(withCredit(old, credit)).toBe(`Fresh greens\n\n${credit}`);
    expect(withCredit(old, null)).toBe("Fresh greens");
    expect(stripMusicCredit("No credit here")).toBe("No credit here");
    // "Music:" inside the text is not a credit line.
    expect(withCredit("We love Music: it helps", credit)).toBe(`We love Music: it helps\n\n${credit}`);
  });

  it("fits the app's caption limit: the body is shortened, never the credit", () => {
    const body = "word ".repeat(600).trim();
    const out = withCredit(body, credit, 2200);
    expect(out.length).toBeLessThanOrEqual(2200);
    expect(out.endsWith(`\n\n${credit}`)).toBe(true);
    expect(out).toContain("…");
    // X's 280 characters.
    const x = withCredit("A".repeat(400), credit, 280);
    expect(x.length).toBeLessThanOrEqual(280);
    expect(x.endsWith(credit)).toBe(true);
  });
});
