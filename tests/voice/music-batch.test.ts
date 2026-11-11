import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { musicTrack: { findMany: mocks.findMany } } }));
vi.mock("@/lib/music/service", () => ({ generateTrack: mocks.generate }));

import { AdminError } from "@/lib/admin/types";
import { BATCH_MAX, batchCostUsd, generateMusicBatch, MUSIC_BATCH } from "@/lib/music/batch";
import { isMood } from "@/lib/music/tracks";

// Growing the music library (owner, 11 November 2026): 30 planned tracks, cost confirmed first, never run by itself.

const ctx = { actor: "admin", ip: null, viaApi: false } as never;

describe("music batch", () => {
  beforeEach(() => {
    mocks.findMany.mockReset().mockResolvedValue([]);
    mocks.generate.mockReset().mockResolvedValue({});
  });

  it("plans 30 tracks, 5 per mood, with unique titles and library moods", () => {
    expect(MUSIC_BATCH).toHaveLength(30);
    expect(new Set(MUSIC_BATCH.map((t) => t.title)).size).toBe(30);
    for (const g of ["afrobeat", "calm", "inspiring", "corporate", "celebration", "chill"]) expect(MUSIC_BATCH.filter((t) => t.group === g)).toHaveLength(5);
    expect(MUSIC_BATCH.every((t) => isMood(t.mood) && t.prompt.length >= 10 && t.prompt.length <= 400)).toBe(true);
  });

  it("costs $0.075 a 30-second track and $2.25 for all 30", () => {
    expect(batchCostUsd(1, 30)).toBe(0.075);
    expect(batchCostUsd(30, 30)).toBe(2.25);
  });

  it("refuses without the confirmed cost, then makes the next tracks not yet in the library", async () => {
    await expect(generateMusicBatch(ctx, { count: 5, seconds: 30, confirmUsd: 1 })).rejects.toThrow("Confirm the cost");
    expect(mocks.generate).not.toHaveBeenCalled();
    mocks.findMany.mockResolvedValue([{ title: MUSIC_BATCH[0].title }]);
    const r = await generateMusicBatch(ctx, { count: 9, seconds: 30, confirmUsd: batchCostUsd(BATCH_MAX, 30) });
    expect(r).toEqual({ made: BATCH_MAX, left: 29 - BATCH_MAX, stopped: null });
    expect(mocks.generate.mock.calls[0][1]).toMatchObject({ title: MUSIC_BATCH[1].title, seconds: 30 });
  });

  it("stops at the first refusal (20 a day, library full)", async () => {
    mocks.generate.mockResolvedValueOnce({}).mockRejectedValueOnce(new AdminError("conflict", "20 tracks were generated today. Try again tomorrow."));
    const r = await generateMusicBatch(ctx, { count: 5, seconds: 30, confirmUsd: batchCostUsd(5, 30) });
    expect(r.made).toBe(1);
    expect(r.stopped).toContain("20 tracks");
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });
});
