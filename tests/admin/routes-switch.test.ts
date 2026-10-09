import { beforeEach, describe, expect, it, vi } from "vitest";

// Entry points that start something with an outside service answer in a friendly way while it is switched off.

const h = vi.hoisted(() => ({ off: [] as string[], user: { id: "u1", actorId: "u1", businessId: "b1", role: "OWNER", email: "o@example.com" } }));

vi.mock("@/lib/db", () => ({
  prisma: {
    serviceSwitch: { findMany: vi.fn(async () => h.off.map((service) => ({ service }))) },
    business: { findUnique: vi.fn(async () => ({ id: "b1" })) },
    subscription: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/auth/require-user", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/require-user")>()),
  requireActiveUser: vi.fn(async () => h.user),
  requirePersonalUser: vi.fn(async () => h.user),
  requireTeamUser: vi.fn(async () => h.user),
  requireOwner: vi.fn(async () => h.user),
  checkActiveUser: vi.fn(async () => ({ status: "ok", user: h.user })),
}));
vi.mock("@/lib/canva/config", () => ({ isCanvaEnabled: () => true }));
vi.mock("@/lib/canva/pkce", () => ({ buildAuthorizeUrl: vi.fn(async () => "https://canva.test/authorize"), newCodeVerifier: () => "v", OAUTH_COOKIE: "c", randomToken: () => "t", sealOAuthState: vi.fn(async () => "sealed") }));
vi.mock("@/lib/canva/service", () => ({ openDesignInCanva: vi.fn(), CanvaError: class extends Error {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: vi.fn() }));
vi.mock("@/lib/billing", () => ({ activeProvider: () => "PADDLE", billingAdapter: vi.fn(), isInterval: () => true, isPaidPlan: () => true, priceIdFor: vi.fn() }));
vi.mock("@/lib/billing/paddle", () => ({ invoiceUrl: vi.fn() }));
vi.mock("@/lib/billing/apply", () => ({ applyProviderSubscription: vi.fn() }));

import { GET as socialConnect } from "@/app/api/social/[network]/connect/route";
import { GET as canvaConnect } from "@/app/api/canva/connect/route";
import { POST as canvaOpen } from "@/app/api/canva/open/route";
import { startCheckout, changePlan } from "@/app/dashboard/billing/actions";
import { clearSwitchCache, UNAVAILABLE_MESSAGE } from "@/lib/admin/switch";

beforeEach(() => {
  h.off = [];
  clearSwitchCache();
  process.env.NEXT_PUBLIC_SITE_URL = "https://bupulse.test";
});
const turnOff = (...ids: string[]) => {
  h.off = ids;
  clearSwitchCache();
};
const social = (network: string) => socialConnect(new Request(`https://bupulse.test/api/social/${network}/connect?next=/dashboard/connections`), { params: Promise.resolve({ network }) });

describe("connect routes", () => {
  it("social sign-in is not started for a switched-off network, with an 'unavailable' message on the page the user came from", async () => {
    turnOff("tiktok");
    const res = await social("tiktok");
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/dashboard/connections");
    expect(location.searchParams.get("error")).toBe("unavailable");
  });

  it("Canva connect redirects back with an error, and 'Edit in Canva' answers 503 with the friendly text", async () => {
    turnOff("canva");
    const res = await canvaConnect(new Request("https://bupulse.test/api/canva/connect?next=/dashboard/gallery"));
    expect(new URL(res.headers.get("location")!).searchParams.get("canva")).toBe("error");
    const open = await canvaOpen(new Request("https://bupulse.test/api/canva/open", { method: "POST", body: "{}" }));
    expect(open.status).toBe(503);
    expect((await open.json()).error).toBe(UNAVAILABLE_MESSAGE);
  });

  it("Canva connect works again once it is switched back on", async () => {
    const res = await canvaConnect(new Request("https://bupulse.test/api/canva/connect?next=/dashboard/gallery"));
    expect(res.headers.get("location")).toBe("https://canva.test/authorize");
  });
});

describe("billing", () => {
  it("new checkouts and plan changes are paused while Paddle is off", async () => {
    turnOff("paddle");
    expect(await startCheckout({ plan: "PRO", interval: "MONTH" })).toEqual({ ok: false, error: UNAVAILABLE_MESSAGE });
    expect(await changePlan({ plan: "PRO", interval: "MONTH" })).toEqual({ ok: false, error: UNAVAILABLE_MESSAGE });
  });
});
