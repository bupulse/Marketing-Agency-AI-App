import { describe, expect, it, vi } from "vitest";
import { OWNER_PAGES, isOwnerOnly, owns, withoutOwnerFields } from "@/video-lab/scope";

vi.mock("@/video-lab/data-source", () => ({ photoJpeg: vi.fn(async (id: string, _px: number, businessId?: string) => ({ bytes: Buffer.from(`${id}:${businessId ?? "any"}`) })), mediaBytes: vi.fn(async () => ({ bytes: Buffer.from("m"), mimeType: "video/mp4" })) }));
vi.mock("@/video-lab/cutouts", () => ({ cutoutForPhoto: vi.fn(async () => ({ ok: true, png: Buffer.from("c"), box: null })) }));
vi.mock("@/video-lab/influencers", () => ({ portraitBytes: vi.fn(async () => Buffer.from("p")) }));
vi.mock("@/video-lab/seedance-jobs", () => ({ seedanceVideoBytes: vi.fn(async () => Buffer.from("v")) }));
vi.mock("@/video-lab/store", () => ({ readVideo: vi.fn(async () => Buffer.from("v")) }));

describe("a client sees only their own business", () => {
  it("lets the owner see everything and a client only their business", () => {
    expect(owns(null, "b-1")).toBe(true);
    expect(owns(null, null)).toBe(true);
    expect(owns("b-1", "b-1")).toBe(true);
    expect(owns("b-1", "b-2")).toBe(false);
    expect(owns("b-1", null)).toBe(false);
    expect(owns("b-1", undefined)).toBe(false);
    expect(owns("b-1", "")).toBe(false);
  });

  it("keeps the business list, test wallet, test tools and shared portraits for the owner", () => {
    expect(isOwnerOnly("GET", "/api/businesses")).toBe(true);
    expect(isOwnerOnly("POST", "/api/wallet/topup")).toBe(true);
    expect(isOwnerOnly("POST", "/api/sample")).toBe(true);
    expect(isOwnerOnly("POST", "/api/template-previews")).toBe(true);
    expect(isOwnerOnly("POST", "/api/influencers/amina/portrait")).toBe(true);
    expect(isOwnerOnly("GET", "/api/products")).toBe(false);
    expect(isOwnerOnly("GET", "/api/influencers/amina/portrait")).toBe(false);
    expect(OWNER_PAGES.has("/viral")).toBe(true);
    expect(OWNER_PAGES.has("/create")).toBe(false);
  });

  it("takes provider costs and the test budget out of what a client is sent", () => {
    const job = { id: "j", costUsd: 0.2, estimateUsd: 0.3, apiEquivalentUsd: 0.1, billedTo: "api", usage: [{ costUsd: 1 }], spec: { scenes: [1] }, credits: 5 };
    expect(withoutOwnerFields({ jobs: [job], spentUsd: 1, capUsd: 5 })).toEqual({ jobs: [{ id: "j", spec: { scenes: [1] }, credits: 5 }] });
    expect(withoutOwnerFields("text")).toBe("text");
    expect(withoutOwnerFields(null)).toBeNull();
  });
});

describe("a client's references", () => {
  it("leaves out uploads, other businesses' videos and keeps their own photos and videos", async () => {
    const { loadReferenceSources } = await import("@/video-lab/seedance-sources");
    const scope = { videoOwned: async (_engine: string, id: string) => id === "sd-mine" };
    const refs = [
      { id: "ph:asset-aaaaaaaaaa", kind: "image" },
      { id: "up:up-0123456789ab", kind: "image" },
      { id: "um:um-0123456789ab", kind: "video" },
      { id: "vid:seedance:sd-mine", kind: "video" },
      { id: "vid:seedance:sd-theirs", kind: "video" },
      { id: "vid:claude:20261019-abcdef12", kind: "video" },
    ];
    const client = await loadReferenceSources(refs, "b-1", scope);
    expect(client.sources.map((s) => s.label)).toEqual(["the product photo", "the video"]);
    expect(client.problems).toHaveLength(4);
    const owner = await loadReferenceSources(refs, "b-1");
    expect(owner.sources).toHaveLength(6);
  });
});
