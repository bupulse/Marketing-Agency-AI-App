import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as grant from "@/tests/stubs/entitlements";

// A few gated entry points, each in both states: refused in words (403 / "Add to your plan") when the plan lacks the
// feature, through when it has it. The entitlement lookup itself is covered in entitlements.test.ts; here the stub
// decides, and the test checks the wiring of each route and action.

vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));

const h = vi.hoisted(() => ({
  user: { id: "u1", actorId: "u1", businessId: "b1", role: "OWNER", email: "o@example.com" },
  prisma: {
    business: { findUnique: vi.fn(async () => ({ id: "b1" })) },
    lead: { findMany: vi.fn(async () => []) },
    chatWidget: { updateMany: vi.fn(async () => ({ count: 0 })) },
  },
  openDesignInCanva: vi.fn(async () => ({ editUrl: "https://canva.test/edit" })),
  runAutopilotForUser: vi.fn(async () => ({ status: "planned", postCount: 2, groupCount: 1 })),
  widget: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({
  requireActiveUser: vi.fn(async () => h.user),
  requirePersonalUser: vi.fn(async () => h.user),
  checkActiveUser: vi.fn(async () => ({ status: "ok", user: h.user })),
}));
vi.mock("@/lib/admin/switch", async (orig) => ({ ...(await orig<typeof import("@/lib/admin/switch")>()), isServiceEnabled: vi.fn(async () => true) }));
vi.mock("@/lib/canva/config", () => ({ isCanvaEnabled: () => true }));
vi.mock("@/lib/canva/pkce", () => ({ buildAuthorizeUrl: vi.fn(async () => "https://canva.test/authorize"), newCodeVerifier: () => "v", OAUTH_COOKIE: "c", randomToken: () => "t", sealOAuthState: vi.fn(async () => "sealed") }));
vi.mock("@/lib/canva/service", () => ({ openDesignInCanva: h.openDesignInCanva, CanvaError: class extends Error {} }));
vi.mock("@/lib/autopilot/manage", () => ({ saveSettings: vi.fn(), approveAll: vi.fn(), removeGroup: vi.fn(), regenerateGroup: vi.fn() }));
vi.mock("@/lib/autopilot/run", () => ({ runAutopilotForUser: h.runAutopilotForUser }));
vi.mock("@/lib/widget/config", () => ({ loadPublicWidget: h.widget }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { GET as leadsExport } from "@/app/api/leads/export/route";
import { POST as canvaOpen } from "@/app/api/canva/open/route";
import { GET as canvaConnect } from "@/app/api/canva/connect/route";
import { GET as widgetConfig } from "@/app/api/widget/config/route";
import { planNextWeek } from "@/app/dashboard/autopilot/actions";

beforeEach(() => {
  grant.missing.clear();
  grant.serviceOff.clear();
  process.env.NEXT_PUBLIC_SITE_URL = "https://bupulse.test";
  h.widget.mockResolvedValue({ businessId: "b1", enabled: true, inPlan: true, allowedDomains: [], accent: "#000", accentText: "#fff", position: "right", contentLanguage: "English" });
});

describe("leads export", () => {
  it("is the company's own data: the CSV comes with or without website chat in the plan", async () => {
    grant.missing.add("websiteChat");
    const without = await leadsExport(new NextRequest("https://bupulse.test/api/leads/export"));
    expect(without.status).toBe(200);
    expect(without.headers.get("content-type")).toContain("text/csv");
    expect(h.prisma.lead.findMany).toHaveBeenCalledTimes(1);

    grant.missing.clear();
    const ok = await leadsExport(new NextRequest("https://bupulse.test/api/leads/export"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/csv");
  });
});

describe("Canva", () => {
  const open = () => canvaOpen(new Request("https://bupulse.test/api/canva/open", { method: "POST", body: JSON.stringify({ designId: "d1" }) }));

  it("'Edit in Canva' is 403 without the feature, 503 while its service is off, and works with it", async () => {
    grant.missing.add("canva");
    expect((await open()).status).toBe(403);
    expect(h.openDesignInCanva).not.toHaveBeenCalled();
    grant.missing.clear();
    grant.serviceOff.add("canva");
    expect((await open()).status).toBe(503);
    grant.serviceOff.clear();
    expect((await open()).status).toBe(200);
    expect(h.openDesignInCanva).toHaveBeenCalledWith("u1", "d1", "u1");
  });

  it("connect sends a company without the feature to 'Add to your plan' instead of Canva", async () => {
    grant.missing.add("canva");
    const res = await canvaConnect(new Request("https://bupulse.test/api/canva/connect?next=/dashboard/designs"));
    expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search).toBe("/dashboard/upgrade?feature=canva");
    grant.missing.clear();
    expect((await canvaConnect(new Request("https://bupulse.test/api/canva/connect"))).headers.get("location")).toBe("https://canva.test/authorize");
  });
});

describe("Autopilot action", () => {
  it("answers in words without the feature and plans with it", async () => {
    grant.missing.add("autopilot");
    expect(await planNextWeek()).toEqual({ ok: false, error: "Autopilot is not part of your plan. Add it to your plan to use it." });
    expect(h.runAutopilotForUser).not.toHaveBeenCalled();
    grant.missing.clear();
    expect(await planNextWeek()).toMatchObject({ ok: true });
  });
});

describe("public widget config", () => {
  it("answers a neutral 'unavailable' for a plan without website chat, before any other reason: the plan is not public", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    h.widget.mockResolvedValue({ businessId: "b1", enabled: false, inPlan: false, allowedDomains: [] });
    const res = await widgetConfig(new Request("https://bupulse.test/api/widget/config?key=KEY12345678"));
    const body = await res.json();
    expect(body).toEqual({ enabled: false, reason: "unavailable" });
    expect(JSON.stringify(body)).not.toContain("plan");
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("not in the plan"));
    expect(h.prisma.chatWidget.updateMany).not.toHaveBeenCalled();
  });
});
