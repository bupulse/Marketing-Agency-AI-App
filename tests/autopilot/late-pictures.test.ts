import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ findMany: vi.fn(), render: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: { contentVisual: { findMany: h.findMany } } }));
vi.mock("@/lib/visuals/service", () => ({ renderImageStep: h.render }));

import { finishLatePictures } from "@/lib/autopilot/late-pictures";

const plan = (deferred: boolean) => ({ version: 1, pack: "bold", aspectRatio: "4:5", directedBy: "rules", notes: [], slides: [{ template: "announcement", headline: "Hi", source: "ai", designId: null, path: null }], ...(deferred ? { deferredFrom: ["u1/designs/stand-in.jpg"] } : {}) });
const row = (id: string, deferred = true) => ({ id, businessId: `b-${id}`, plan: plan(deferred), business: { userId: `u-${id}` } });

beforeEach(() => {
  h.findMany.mockReset();
  h.render.mockReset();
});

describe("Autopilot's pictures made later (Netlify's 60 s)", () => {
  it("answers at once with one small read when no picture waits", async () => {
    h.findMany.mockResolvedValue([]);
    expect(await finishLatePictures()).toEqual({ checked: 0, stepped: 0, ready: 0, nextCursor: null });
    expect(h.render).not.toHaveBeenCalled();
    expect(h.findMany.mock.calls[0][0]).toMatchObject({ where: { status: "pending", groupId: { not: null } }, take: 20 });
  });

  it("takes one step of each waiting picture, as the company's background job, and asks to be called again while some are left", async () => {
    h.findMany.mockResolvedValue([row("v1"), row("v2"), row("owner-opens-it", false)]);
    h.render.mockResolvedValueOnce({ status: "ready" }).mockResolvedValueOnce({ status: "pending" });
    const out = await finishLatePictures();
    expect(out).toEqual({ checked: 2, stepped: 2, ready: 1, nextCursor: "more" });
    expect(h.render.mock.calls[0].slice(0, 2)).toEqual([{ userId: "u-v1", businessId: "b-v1", service: true }, "v1"]);
    // A pending visual Autopilot did not leave for later is drawn when the owner opens it.
    expect(h.render.mock.calls.map((c) => c[1])).toEqual(["v1", "v2"]);
  });

  it("stops when its 25 s are used and leaves the rest for the next call", async () => {
    h.findMany.mockResolvedValue([row("v1"), row("v2")]);
    let clock = 0;
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    h.render.mockImplementation(async () => {
      clock += 26_000;
      return { status: "pending" };
    });
    const out = await finishLatePictures();
    now.mockRestore();
    expect(out).toMatchObject({ stepped: 1, nextCursor: "more" });
  });

  it("is done when every waiting picture is ready", async () => {
    h.findMany.mockResolvedValue([row("v1")]);
    h.render.mockResolvedValue({ status: "ready" });
    expect((await finishLatePictures()).nextCursor).toBeNull();
  });
});
