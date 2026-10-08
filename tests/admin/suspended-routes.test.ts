import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ check: vi.fn(), preview: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ checkActiveUser: m.check }));
vi.mock("@/lib/designs/service", () => ({ previewTemplate: m.preview }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: vi.fn() }));

import { GET } from "@/app/api/designs/preview/route";

const req = () => new Request("https://bupulse.test/api/designs/preview?template=bold-quote&ratio=1:1");

describe("/api/designs/preview", () => {
  it("is closed to suspended and signed-out users and renders nothing", async () => {
    m.check.mockResolvedValueOnce({ status: "suspended" });
    expect((await GET(req())).status).toBe(403);
    m.check.mockResolvedValueOnce({ status: "signed_out" });
    expect((await GET(req())).status).toBe(401);
    expect(m.preview).not.toHaveBeenCalled();
  });
});
