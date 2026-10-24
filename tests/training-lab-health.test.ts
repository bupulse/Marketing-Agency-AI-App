import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { trainingExample: { findMany: m.findMany } } }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));

const { labHealth, healthRows, HEALTH_ROWS } = await import("@/lib/training-lab/health");
type HealthRow = import("@/lib/training-lab/health").HealthRow;

const row = (over: Partial<HealthRow> = {}): HealthRow => ({ id: "r1", kind: "reel", title: "Good reel", path: "a/r1/reel.mp4", mime: "video/mp4", sourceUrl: null, engines: ["reel"], consentGiven: false, transcript: null, rating: 5, neverThis: null, notes: null, ...over });
const problems = (rows: HealthRow[], missing?: Set<string>) => labHealth(rows, missing).map((i) => `${i.id}: ${i.problem}`);

describe("Lab health", () => {
  it("finds nothing wrong with good examples", () => {
    expect(labHealth([
      row(),
      row({ id: "a1", kind: "actor", mime: "image/jpeg", consentGiven: true, engines: ["presenter"] }),
      row({ id: "v1", kind: "voice", mime: "audio/mpeg", transcript: "Muraho", engines: ["language"] }),
      row({ id: "s1", kind: "schedule", path: null, mime: null, engines: ["schedule"], notes: { network: "facebook", hours: [7, 19] } }),
      row({ id: "low", rating: 1, neverThis: "Never a shaky camera." }),
      row({ id: "link", path: null, sourceUrl: "https://example.com/v" }),
    ])).toEqual([]);
  });

  it("names each problem in plain words, with the example", () => {
    expect(problems([
      row({ id: "off", engines: [] }),
      row({ id: "noconsent", kind: "actor", mime: "image/jpeg", consentGiven: false, engines: ["presenter"] }),
      row({ id: "video", kind: "actor", consentGiven: true, engines: ["presenter"] }),
      row({ id: "quiet", kind: "voice", mime: "audio/mpeg", transcript: " ", engines: ["post"] }),
      row({ id: "habit", kind: "schedule", path: null, mime: null, engines: ["schedule"], notes: { network: "nowhere" } }),
      row({ id: "unfinished", path: null }),
      row({ id: "gone" }),
      row({ id: "why", rating: 2 }),
    ], new Set(["gone"]))).toEqual([
      "off: No engine reads it: switch at least one on.",
      "noconsent: Never used: no consent.",
      "video: Make a portrait from the video: the presenters use photos only.",
      "quiet: Write what is said in the recording.",
      "quiet: Switch on Kinyarwanda words and captions, or the writers never hear it.",
      "habit: The posting habit cannot be read: edit it and give hours or days.",
      "unfinished: The file never finished uploading: add it again.",
      "gone: The file is missing from Storage: add it again.",
      "why: Say what to avoid, so the engines learn the reason.",
    ]);
  });

  it("knows an actor's video has a portrait once one was made from it", () => {
    const video = row({ id: "video", kind: "actor", consentGiven: true, engines: ["presenter"] });
    const portrait = row({ id: "p1", kind: "actor", mime: "image/jpeg", consentGiven: true, engines: ["presenter"], notes: { from_video: "video", at_seconds: 2 } });
    expect(labHealth([video, portrait])).toEqual([]);
  });

  it("reads at most the newest few hundred examples, and says nothing when the database fails", async () => {
    m.findMany.mockResolvedValueOnce([row()]);
    expect(await healthRows()).toHaveLength(1);
    expect(m.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: "desc" }, take: HEALTH_ROWS }));
    m.findMany.mockRejectedValueOnce(new Error("down"));
    expect(await healthRows()).toBeNull();
  });
});
