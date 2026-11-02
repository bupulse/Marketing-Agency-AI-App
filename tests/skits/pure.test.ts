import { describe, expect, it } from "vitest";
import { cleanLimits } from "@/lib/plan-catalog";
import { skitsPerWeekLimit } from "@/lib/plans";
import { authHeader, higgsfieldBody, readStatus, skitVideoStatus, submitSkitVideo, SKIT_MODEL } from "@/lib/skits/higgsfield";
import { skitVideoPrompt } from "@/lib/skits/prompt";
import { isSkitDay, nextSkitDay, skitDaysText, skitWeekdays } from "@/lib/skits/schedule";
import { checkVoice, missingVoices, readLines, readSpeakers, voiceType } from "@/lib/skits/shared";
import { encodeWav, mixToMono, trimSilence } from "@/lib/skits/wav";
import { buildSkitPrompt, fitSkit } from "@/lib/skits/writer";

describe("the skit plan limit", () => {
  it("is 0 when missing and held to 0..7", () => {
    expect(skitsPerWeekLimit(undefined)).toBe(0);
    expect(skitsPerWeekLimit({})).toBe(0);
    expect(skitsPerWeekLimit({ skitsPerWeek: 2 })).toBe(2);
    expect(skitsPerWeekLimit({ skitsPerWeek: 12 })).toBe(7);
    expect(skitsPerWeekLimit({ skitsPerWeek: -1 })).toBe(0);
  });
  it("is read from the plan row", () => {
    expect(cleanLimits({ text: 1, skitsPerWeek: 3 }).skitsPerWeek).toBe(3);
    expect(cleanLimits({ text: 1 }).skitsPerWeek).toBeUndefined();
  });
});

describe("skit days", () => {
  // 2 November 2026 is a Monday.
  it("spreads Business over Tuesday and Friday, Business Pro over Monday, Wednesday and Friday", () => {
    expect(skitWeekdays(2)).toEqual([1, 4]);
    expect(skitWeekdays(3)).toEqual([0, 2, 4]);
    expect(isSkitDay(2, "2026-11-03")).toBe(true);
    expect(isSkitDay(2, "2026-11-06")).toBe(true);
    expect(isSkitDay(2, "2026-11-02")).toBe(false);
    expect(["2026-11-02", "2026-11-04", "2026-11-06"].every((d) => isSkitDay(3, d))).toBe(true);
    expect(isSkitDay(3, "2026-11-03")).toBe(false);
    expect(isSkitDay(0, "2026-11-03")).toBe(false);
  });
  it("finds the next skit day and names the days", () => {
    expect(nextSkitDay(2, "2026-11-04")).toBe("2026-11-06");
    expect(nextSkitDay(2, "2026-11-03")).toBe("2026-11-03");
    expect(nextSkitDay(2, "2026-11-07")).toBe("2026-11-10");
    expect(nextSkitDay(0, "2026-11-03")).toBeNull();
    expect(skitDaysText(2)).toBe("Tuesday and Friday");
    expect(skitDaysText(3)).toBe("Monday, Wednesday and Friday");
  });
  it("has every day once for each count", () => {
    for (let n = 0; n <= 7; n++) expect(new Set(skitWeekdays(n)).size).toBe(n);
  });
});

describe("voice notes", () => {
  it("takes WhatsApp, iPhone and recorded notes, by type or by file ending", () => {
    expect(voiceType({ type: "audio/ogg; codecs=opus" })).toBe("audio/ogg");
    expect(voiceType({ type: "application/octet-stream", name: "PTT-20261102-WA0003.opus" })).toBe("audio/opus");
    expect(voiceType({ type: "", name: "note.m4a" })).toBe("audio/mp4");
    expect(voiceType({ type: "audio/wav" })).toBe("audio/wav");
    expect(voiceType({ type: "video/mp4", name: "clip.mov" })).toBeNull();
  });
  it("refuses empty, too big and wrong files", () => {
    expect(checkVoice({ type: "audio/wav", size: 1000 })).toEqual({ ok: true, mime: "audio/wav", ext: "wav" });
    expect(checkVoice({ type: "audio/wav", size: 0 }).ok).toBe(false);
    expect(checkVoice({ type: "audio/wav", size: 9 * 1024 * 1024 }).ok).toBe(false);
    expect(checkVoice({ type: "image/png", size: 10, name: "x.png" }).ok).toBe(false);
  });
  it("knows which speakers still need a voice", () => {
    expect(missingVoices(2, ["a", ""])).toEqual([2]);
    expect(missingVoices(2, ["a"])).toEqual([2]);
    expect(missingVoices(1, ["a"])).toEqual([]);
  });
  it("writes a valid 16-bit mono WAV", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16000);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(wav.byteLength).toBe(52);
  });
  it("mixes to mono and trims silence at both ends", () => {
    expect([...mixToMono([new Float32Array([1, 0]), new Float32Array([0, 0])])]).toEqual([0.5, 0]);
    const s = new Float32Array(16000 * 2);
    s.fill(0.5, 16000, 16000 + 1600);
    const trimmed = trimSilence(s, 16000, 0.02, 0.1);
    expect(trimmed.length).toBe(1600 + 2 * 1600);
  });
});

describe("the skit writer", () => {
  const raw = {
    title: "  The rain umbrella  ",
    scene: "A market stall in Kigali.",
    speakers: [
      { name: "Seller", look: "young woman, kitenge" },
      { name: "Silent", look: "says nothing" },
      { name: "Customer", look: "man in a hurry" },
    ],
    lines: [
      { speaker: 1, text: "  Imvura  iraje! " },
      { speaker: 3, text: "Mfite umutaka?" },
      { speaker: 1, text: "Yego, 5,000 gusa." },
    ],
    caption: "Umutaka mwiza.",
    hashtags: ["#Kigali", "rain"],
  };
  it("drops speakers who say nothing and renumbers the others", () => {
    const skit = fitSkit(raw);
    expect(skit.speakers.map((s) => s.name)).toEqual(["Seller", "Customer"]);
    expect(skit.lines.map((l) => l.speaker)).toEqual([1, 2, 1]);
    expect(skit.lines[0].text).toBe("Imvura iraje!");
    expect(skit.title).toBe("The rain umbrella");
    expect(skit.hashtags).toEqual(["Kigali", "rain"]);
  });
  it("refuses a skit without lines", () => {
    expect(() => fitSkit({ ...raw, lines: [{ speaker: 9, text: "x" }] })).toThrow();
  });
  it("asks for the lines in the skit language, with the facts fenced", () => {
    const prompt = buildSkitPrompt({ businessName: "Mama Shop", description: "Umbrellas", language: "Kinyarwanda", subject: { title: "Umbrella", context: "<<<PRODUCT\nRed umbrella\nPRODUCT>>>", price: "5,000 RWF" }, knowledgeBase: null, voiceProfile: null, recent: ["Old idea"] });
    expect(prompt).toContain("Write the lines and the caption in Kinyarwanda");
    expect(prompt).toContain("<<<ABOUT THE BUSINESS");
    expect(prompt).toContain("Price: 5,000 RWF");
    expect(prompt).toContain("Old idea");
  });
  it("reads stored lines and speakers defensively", () => {
    expect(readLines([{ speaker: 1, text: "a" }, { speaker: 4, text: "b" }, { speaker: 1, text: "" }, null], 2)).toEqual([{ speaker: 1, text: "a" }]);
    expect(readSpeakers([{ name: "" }, { name: "Customer", look: "x" }])).toEqual([{ name: "Person 1", look: "" }, { name: "Customer", look: "x" }]);
    expect(readLines("nope")).toEqual([]);
  });
});

describe("the video prompt", () => {
  it("ties each person to their own voice and keeps the lines in order", () => {
    const p = skitVideoPrompt({ businessName: "Mama Shop", scene: "A market stall.", speakers: [{ name: "Seller", look: "kitenge" }, { name: "Customer", look: "" }], lines: [{ speaker: 1, text: "Muraho" }, { speaker: 2, text: "Yego" }], language: "Kinyarwanda", imageCount: 2 });
    expect(p).toContain("Person 1, Seller (kitenge), speaks with the voice of @Audio1");
    expect(p).toContain("Person 2, Customer, speaks with the voice of @Audio2");
    expect(p.indexOf('Person 1: "Muraho"')).toBeLessThan(p.indexOf('Person 2: "Yego"'));
    expect(p).toContain("@Image1 to @Image2");
  });
});

describe("the Higgsfield client", () => {
  const env = { HF_CREDENTIALS: "id123:secret456" };
  it("builds the auth header from HF_CREDENTIALS or the two keys", () => {
    expect(authHeader(env)).toBe("Key id123:secret456");
    expect(authHeader({ HF_API_KEY: "a", HF_API_SECRET: "b" })).toBe("Key a:b");
    expect(authHeader({})).toBeNull();
  });
  it("holds the body to the model's limits", () => {
    const body = higgsfieldBody({ prompt: "p", imageUrls: Array.from({ length: 12 }, (_, i) => `i${i}`), audioUrls: ["a", "b", "c", "d"], seconds: 30 });
    expect(body).toMatchObject({ prompt: "p", duration: 15, resolution: "480p", aspect_ratio: "9:16" });
    expect((body.image_urls as string[]).length).toBe(9);
    expect((body.audio_urls as string[]).length).toBe(3);
    expect(higgsfieldBody({ prompt: "p", imageUrls: [], audioUrls: [], seconds: 1 }).duration).toBe(4);
  });
  it("reads the request statuses", () => {
    expect(readStatus({ status: "queued" }).status).toBe("waiting");
    expect(readStatus({ status: "in_progress" }).status).toBe("waiting");
    expect(readStatus({ status: "completed", video: { url: "https://cdn/x.mp4" } })).toEqual({ status: "completed", videoUrl: "https://cdn/x.mp4", error: null });
    expect(readStatus({ status: "completed" }).status).toBe("failed");
    expect(readStatus({ status: "nsfw" }).error).toMatch(/moderation/);
    expect(readStatus({ status: "failed", error: "bad audio" }).error).toBe("bad audio");
  });
  it("submits to the model path and polls the request (fake fetch, no real call)", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fake = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(url.endsWith("/status") ? { status: "completed", video: { url: "https://cdn/v.mp4" } } : { status: "queued", request_id: "req-1" }), { status: 200 });
    };
    expect(await submitSkitVideo({ prompt: "p", imageUrls: ["i"], audioUrls: ["a"], seconds: 10 }, { env, fetch: fake })).toBe("req-1");
    expect(calls[0].url).toBe(`https://api.higgsfield.ai/${SKIT_MODEL}`);
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe("Key id123:secret456");
    expect(JSON.parse(String(calls[0].init?.body)).audio_urls).toEqual(["a"]);
    expect(await skitVideoStatus("req-1", { env, fetch: fake })).toEqual({ status: "completed", videoUrl: "https://cdn/v.mp4", error: null });
    expect(calls[1].url).toBe("https://api.higgsfield.ai/requests/req-1/status");
  });
  it("says whether an error is worth retrying, and never calls without a key", async () => {
    const answer = (status: number) => async () => new Response("nope", { status });
    await expect(submitSkitVideo({ prompt: "p", imageUrls: [], audioUrls: [], seconds: 10 }, { env, fetch: answer(503) })).rejects.toMatchObject({ retryable: true });
    await expect(submitSkitVideo({ prompt: "p", imageUrls: [], audioUrls: [], seconds: 10 }, { env, fetch: answer(422) })).rejects.toMatchObject({ retryable: false });
    let called = false;
    await expect(submitSkitVideo({ prompt: "p", imageUrls: [], audioUrls: [], seconds: 10 }, { env: {}, fetch: async () => ((called = true), new Response("{}")) })).rejects.toThrow(/not set up/);
    expect(called).toBe(false);
  });
});
