import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: async (_c: unknown, _m: unknown, call: () => unknown) => call() }));

import { findBeat } from "@/lib/reel-engine/beats";
import { checkClip, readClipVerdict } from "@/lib/reel-engine/checker";

/** A made-up track: a short click every `period` seconds from `offset`, over a quiet hum. */
function clicks(period: number, offset: number, seconds = 20, rate = 22050): Float32Array {
  const out = new Float32Array(seconds * rate);
  for (let i = 0; i < out.length; i++) out[i] = 0.02 * Math.sin((2 * Math.PI * 110 * i) / rate);
  for (let t = offset; t < seconds; t += period) for (let k = 0; k < 400; k++) out[Math.floor(t * rate) + k] += 0.8 * Math.exp(-k / 80) * (k % 2 ? 1 : -1);
  return out;
}

describe("the music's beat", () => {
  it("finds the tempo and the first beat of a track", () => {
    for (const [period, offset] of [[0.5, 0.2], [0.6, 0.05], [0.43, 0.3]]) {
      const beat = findBeat(clicks(period, offset), 22050)!;
      expect(beat.period).toBeCloseTo(period, 1);
      const phase = (((offset - beat.offset) % beat.period) + beat.period) % beat.period;
      // Within about two video frames (80 ms): an edit that close to the beat reads as on it.
      expect(Math.min(phase, beat.period - phase)).toBeLessThan(0.08);
    }
  });
  it("has no beat in silence or a sound too short", () => {
    expect(findBeat(new Float32Array(22050 * 5), 22050)).toBeNull();
    expect(findBeat(new Float32Array(100), 22050)).toBeNull();
  });
});

describe("the clip checker", () => {
  it("fails a clip only for a stated problem", () => {
    expect(readClipVerdict({ ok: false, problems: ["2 s: her hand passes through the leaves"] })).toEqual({ ok: false, problems: ["2 s: her hand passes through the leaves"], ran: true });
    expect(readClipVerdict({ ok: false, problems: [] }).ok).toBe(true);
    expect(readClipVerdict({ ok: true, problems: [] }).ok).toBe(true);
    expect(readClipVerdict(null).ok).toBe(true);
  });
  it("sends the clip with the rules and the setting, and passes the clip when the check cannot run", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      expect(body.contents[0].parts[0].inline_data.mime_type).toBe("video/mp4");
      expect(body.contents[0].parts[1].text).toMatch(/passes through another object/);
      expect(body.contents[0].parts[1].text).toContain("SETTING: a greenhouse.");
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":false,"problems":["4 s: a man walks through the tower"]}' }] } }], usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 40 } }));
    });
    const owner = { userId: "u1", businessId: "b1" };
    expect(await checkClip(owner, new Uint8Array([0, 0, 0, 24]), "a greenhouse", { fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ ok: false, problems: ["4 s: a man walks through the tower"], ran: true });
    const broken = vi.fn(async () => new Response("busy", { status: 503 }));
    expect(await checkClip(owner, new Uint8Array([1]), null, { fetchImpl: broken as unknown as typeof fetch })).toEqual({ ok: true, problems: [], ran: false });
  });
});
