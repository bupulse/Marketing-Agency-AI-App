import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));

type Clip = Record<string, unknown> & { businessId: string; hash: string; status: string };
const db = vi.hoisted(() => ({ clips: [] as Clip[], language: "English" as string | null, spec: null as unknown, voiceClipId: null as string | null, job: { voiceCredits: 0, voicePeriodStart: null as Date | null, voiceReservedAt: null as Date | null }, heldDuringSpeak: 0 }));
const prisma = vi.hoisted(() => ({
  business: { findUnique: vi.fn(async (args: { where: { userId?: string; id?: string } }) => (args.where.userId ? { id: "b1" } : { contentLanguage: db.language })) },
  videoJob: {
    findFirst: vi.fn(async ({ where }: { where: { id: string; businessId: string } }) => (where.id === "j1" && where.businessId === "b1" ? { id: "j1", status: "designed", spec: db.spec } : null)),
    update: vi.fn(async ({ data }: { data: { voiceClipId: string } }) => {
      db.voiceClipId = data.voiceClipId;
      return {};
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; voiceCredits?: number | { gt: number }; voiceReservedAt?: Date }; data: typeof db.job }) => {
      const j = db.job;
      if (where.voiceCredits === 0 && j.voiceCredits !== 0) return { count: 0 };
      if (typeof where.voiceCredits === "object" && !(j.voiceCredits > 0 && j.voiceReservedAt?.getTime() === where.voiceReservedAt?.getTime())) return { count: 0 };
      Object.assign(j, data);
      return { count: 1 };
    }),
  },
  voiceClip: {
    findUnique: vi.fn(async ({ where }: { where: { businessId_hash: { businessId: string; hash: string } } }) => db.clips.find((c) => c.businessId === where.businessId_hash.businessId && c.hash === where.businessId_hash.hash) ?? null),
    create: vi.fn(async ({ data }: { data: Clip }) => {
      if (db.clips.some((c) => c.businessId === data.businessId && c.hash === data.hash)) {
        const { Prisma } = await import("@/lib/generated/prisma/client");
        throw new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "7" });
      }
      db.clips.push({ id: `vc${db.clips.length + 1}`, updatedAt: new Date(), path: null, ...data });
      return data;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { businessId: string; hash: string; status?: string }; data: Record<string, unknown> }) => {
      const hit = db.clips.filter((c) => c.businessId === where.businessId && c.hash === where.hash && (!where.status || c.status === where.status));
      for (const c of hit) Object.assign(c, data);
      return { count: hit.length };
    }),
    deleteMany: vi.fn(async ({ where }: { where: { businessId: string; hash: string; status: string } }) => {
      const before = db.clips.length;
      db.clips = db.clips.filter((c) => !(c.businessId === where.businessId && c.hash === where.hash && c.status === where.status));
      return { count: before - db.clips.length };
    }),
  },
}));
const usage = vi.hoisted(() => {
  class UsageLimitError extends Error {
    constructor(public reason: string) {
      super(reason);
    }
  }
  return { consumeUsage: vi.fn(async () => ({ periodStart: new Date("2026-10-01T00:00:00Z") })), refundUsage: vi.fn(async () => {}), UsageLimitError };
});
const ledger = vi.hoisted(() => ({ calls: [] as { feature: string; provider: string; userId: string }[] }));
const switchState = vi.hoisted(() => ({ off: false }));
const storage = vi.hoisted(() => ({ files: new Set<string>() }));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/usage", () => usage);
vi.mock("@/lib/auth/require-user", () => ({ checkActiveUser: vi.fn(async () => ({ status: "ok", user: { id: "u1", actorId: "a1", role: "MEMBER", businessId: "b1" } })) }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: vi.fn() }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/content-board/settings-service", () => ({ getContentSettings: vi.fn(async () => ({ voiceId: "NZ8KtusXpnktPYja5Qko" })) }));
vi.mock("@/lib/media/service", () => ({ MediaError: class extends Error {}, mediaUsage: vi.fn(async () => ({ count: 0, bytes: 0 })), assertPlatformRoom: vi.fn(async () => {}) }));
vi.mock("@/lib/admin/switch", async (orig) => {
  const real = await orig<typeof import("@/lib/admin/switch")>();
  return { ...real, assertServiceEnabled: vi.fn(async (id: string) => { if (switchState.off) throw new real.ServiceDisabledError(id as "elevenlabs"); }) };
});
vi.mock("@/lib/ai/ledger", () => ({
  withLedger: vi.fn(async (ctx: { feature: string; userId: string }, meta: { provider: string }, call: () => Promise<unknown>) => {
    ledger.calls.push({ feature: ctx.feature, provider: meta.provider, userId: ctx.userId });
    return call();
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        info: vi.fn(async (path: string) => (storage.files.has(path) ? { data: { size: 10 }, error: null } : { data: null, error: new Error("missing") })),
        upload: vi.fn(async (path: string) => {
          storage.files.add(path);
          return { error: null };
        }),
        createSignedUrl: vi.fn(async (path: string) => ({ data: { signedUrl: `https://signed.test/${path}` } })),
      }),
    },
  }),
}));

import { setTtsProvider, type TtsProvider } from "@/lib/ai/tts";
import { POST } from "@/app/api/video/jobs/[id]/voice/route";
import { VOICE_OVER_CREDITS } from "@/lib/video-engine/credits";

const speak = vi.fn<TtsProvider["speak"]>();
const tts: TtsProvider = { name: "elevenlabs", model: "eleven_multilingual_v2", speak };
const spec = (lines: (string | undefined)[]) => ({ version: 1, ratio: "9:16", fps: 30, scenes: lines.map((say) => ({ seconds: 3, background: { kind: "color", color: "#000" }, layers: [], ...(say ? { say } : {}) })) });
const answer = (text: string) => {
  const ends = Array.from(text, (_, i) => (i + 1) * 60);
  return { audio: new Uint8Array([1, 2, 3]), mimeType: "audio/mpeg" as const, charStartsMs: ends.map((e) => e - 60), charEndsMs: ends, durationMs: ends[ends.length - 1], characters: text.length, provider: "elevenlabs", model: "eleven_multilingual_v2" };
};
const call = (id = "j1") => POST(new Request(`https://x.test/api/video/jobs/${id}/voice`, { method: "POST", body: "{}" }), { params: Promise.resolve({ id }) } as never);

beforeEach(() => {
  vi.clearAllMocks();
  db.clips = [];
  db.language = "English";
  db.voiceClipId = null;
  db.job = { voiceCredits: 0, voicePeriodStart: null, voiceReservedAt: null };
  db.heldDuringSpeak = 0;
  db.spec = spec(["Galaxy A56, 420,000 RWF.", "WhatsApp us today."]);
  ledger.calls.length = 0;
  switchState.off = false;
  storage.files.clear();
  speak.mockImplementation(async ({ text }) => {
    db.heldDuringSpeak = db.job.voiceCredits;
    return answer(text);
  });
  setTtsProvider(tts);
});

describe("POST /api/video/jobs/<id>/voice", () => {
  it("a new take: credits first, spoken through the ledger as video-voice, stored, fitted to the design", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const out = (await res.json()) as { voice: { url: string; cues: unknown[]; spec: { scenes: unknown[] }; fits: boolean; cached: boolean; note: string | null }; credits: number };
    expect(usage.consumeUsage).toHaveBeenCalledWith("u1", "videoCredits", VOICE_OVER_CREDITS);
    expect(usage.consumeUsage.mock.invocationCallOrder[0]).toBeLessThan(speak.mock.invocationCallOrder[0]);
    expect(ledger.calls).toEqual([{ feature: "video-voice", provider: "elevenlabs", userId: "a1" }]);
    expect(speak).toHaveBeenCalledWith({ text: "Galaxy A56, 420,000 RWF. WhatsApp us today.", voiceId: "NZ8KtusXpnktPYja5Qko" });
    expect(out.credits).toBe(VOICE_OVER_CREDITS);
    expect(out.voice).toMatchObject({ cached: false, note: null, fits: true });
    expect(out.voice.url).toMatch(/^https:\/\/signed\.test\/voice\/b1\/[0-9a-f]{40}\.mp3$/);
    expect(out.voice.cues).toHaveLength(2);
    expect(db.clips[0]).toMatchObject({ status: "ready", pendingAudio: null });
    expect(db.voiceClipId).toBe("vc1");
    expect(usage.refundUsage).not.toHaveBeenCalled();
    // The credits were held on the job while the take was made, and settled once it was paid for.
    expect(db.heldDuringSpeak).toBe(VOICE_OVER_CREDITS);
    expect(db.job).toEqual({ voiceCredits: 0, voicePeriodStart: null, voiceReservedAt: null });
  });

  it("a second voice-over of the same video while one is held: credits back at once, 409", async () => {
    db.job = { voiceCredits: 15, voicePeriodStart: new Date("2026-10-01T00:00:00Z"), voiceReservedAt: new Date() };
    const res = await call();
    expect(res.status).toBe(409);
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
    expect(speak).not.toHaveBeenCalled();
    expect(db.job.voiceCredits).toBe(15);
  });

  it("a reservation the sweep already gave back is not refunded again when the request fails late", async () => {
    speak.mockImplementationOnce(async () => {
      // The request was slow: the sweep cleared and refunded the reservation meanwhile.
      Object.assign(db.job, { voiceCredits: 0, voicePeriodStart: null, voiceReservedAt: null });
      throw new Error("The voice service did not answer");
    });
    const res = await call();
    expect(res.status).toBe(502);
    expect(usage.refundUsage).not.toHaveBeenCalled();
  });

  it("the same take again is free: nothing charged, nothing spoken", async () => {
    await call();
    vi.clearAllMocks();
    const res = await call();
    const out = (await res.json()) as { voice: { cached: boolean }; credits: number };
    expect(out).toMatchObject({ credits: 0, voice: { cached: true } });
    expect(usage.consumeUsage).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });

  it("a design without voice lines answers null and charges nothing", async () => {
    db.spec = spec([undefined, undefined]);
    const res = await call();
    expect(await res.json()).toEqual({ voice: null, credits: 0 });
    expect(usage.consumeUsage).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });

  it("a voice service failure gives the credits back and frees the take for a later try", async () => {
    speak.mockRejectedValueOnce(new Error("The voice service refused the request (500)"));
    const res = await call();
    expect(res.status).toBe(502);
    expect(((await res.json()) as { message: string }).message).toContain("Your credits are back");
    expect(usage.refundUsage).toHaveBeenCalledWith("u1", "videoCredits", new Date("2026-10-01T00:00:00Z"), VOICE_OVER_CREDITS);
    expect(usage.refundUsage).toHaveBeenCalledTimes(1);
    expect(db.clips).toEqual([]);
    expect(db.job.voiceCredits).toBe(0);
  });

  it("503 in plain English when ElevenLabs is switched off or has no key, before charging", async () => {
    switchState.off = true;
    const off = await call();
    expect(off.status).toBe(503);
    expect(((await off.json()) as { message: string }).message).toMatch(/paused/);
    switchState.off = false;
    setTtsProvider(null);
    const nokey = await call();
    expect(nokey.status).toBe(503);
    expect(usage.consumeUsage).not.toHaveBeenCalled();
  });

  it("Kinyarwanda is spoken in English, with the note; lines still in Kinyarwanda are refused unpaid", async () => {
    db.language = "Kinyarwanda";
    const res = await call();
    const out = (await res.json()) as { voice: { note: string } };
    expect(out.voice.note).toBe("The voice cannot speak Kinyarwanda yet, so the voice-over is in English and the text on screen stays in Kinyarwanda.");
    db.clips = [];
    vi.clearAllMocks();
    db.spec = spec(["Murakaza neza kuri Nova Phones.", "Mugure telefoni nshya uyu munsi."]);
    const refused = await call();
    expect(refused.status).toBe(400);
    expect(usage.consumeUsage).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });

  it("402 when the video credits are used up; 404 for a job of another company", async () => {
    usage.consumeUsage.mockRejectedValueOnce(new usage.UsageLimitError("limit_reached"));
    const blocked = await call();
    expect(blocked.status).toBe(402);
    expect(await blocked.json()).toMatchObject({ error: "usage_blocked", reason: "limit_reached" });
    expect(speak).not.toHaveBeenCalled();
    expect((await call("other")).status).toBe(404);
  });
});
