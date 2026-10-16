import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ values: new Map<string, string>(), sets: [] as { name: string; value: string; options: Record<string, unknown> }[] }));
const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  signIn: vi.fn(),
  signUp: vi.fn(),
  verifyOtp: vi.fn(),
  existing: null as null | { method: string },
}));

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "cf-connecting-ip": "203.0.113.20" }),
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name)! } : undefined),
    set: (name: string, value: string, options: Record<string, unknown>) => { jar.values.set(name, value); jar.sets.push({ name, value, options }); },
    delete: (name: string) => void jar.values.delete(name),
  }),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: mocks.user } }) } }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithPassword: mocks.signIn, signUp: mocks.signUp, verifyOtp: mocks.verifyOtp } }),
}));
vi.mock("@/lib/account", () => ({ findAccountByEmail: async () => mocks.existing, ensureAccount: async () => true }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: vi.fn(async () => {}) }));

import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { signUp } from "@/app/signup/actions";
import { GET as confirm } from "@/app/auth/confirm/route";
import { cleanReturn, RETURN_COOKIE } from "@/lib/auth/return-path";
import { takeReturn } from "@/lib/auth/return-server";
import { countries } from "@/lib/content/countries";

const TARGET = "/custom-plan?from=pricing";

// "Request a custom plan" from the pricing page (docs/OFFERS.md): a visitor signs up first and lands on the request
// form afterwards, through the confirmation email, /welcome and /onboarding (the same return path as a Shopify install).

beforeEach(() => {
  jar.values.clear();
  jar.sets.length = 0;
  mocks.user = null;
  mocks.existing = null;
  mocks.signIn.mockReset().mockResolvedValue({ error: null });
  mocks.signUp.mockReset().mockResolvedValue({ data: { user: { identities: [{}] } }, error: null });
  mocks.verifyOtp.mockReset().mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  process.env.NEXT_PUBLIC_SITE_URL = "https://app.bupulse.test";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "k";
});

const signup = (next: string) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ email: "new@shop.co", organisationName: "Shop", ceoName: "Ann Lee", industry: "other", industryOther: "Corner shop", industryDescription: "A corner shop selling groceries and airtime in Kigali.", country: countries[0], phone: "", website: "", password: "Password-12345!", confirmPassword: "Password-12345!", terms: "true", next })) f.set(k, v);
  return signUp({ status: "idle" }, f);
};

describe("the custom plan request survives sign-up", () => {
  it("a signed-out visitor opening /custom-plan is sent to sign in with the form as next", async () => {
    const res = await proxy(new NextRequest(`https://app.bupulse.test${TARGET}`));
    expect(new URL(res.headers.get("location")!).searchParams.get("next")).toBe(TARGET);
  });

  it("sign-up -> confirmation email -> confirm -> onboarding ends on the request form", async () => {
    await signup(TARGET);
    const link = new URL(mocks.signUp.mock.calls[0][0].options.emailRedirectTo as string);
    expect(link.searchParams.get("next")).toBe(TARGET);
    const res = await confirm(new NextRequest(`https://app.bupulse.test/auth/confirm?token_hash=t&type=signup&next=${encodeURIComponent(link.searchParams.get("next")!)}`));
    expect(res.headers.get("location")).toBe(`https://app.bupulse.test${TARGET}`);
    expect(res.headers.get("set-cookie")).toContain(`${RETURN_COOKIE}=`);
    // /custom-plan sends a new account to /welcome and /onboarding; finishing onboarding takes the remembered path.
    jar.values.set(RETURN_COOKIE, cleanReturn(TARGET));
    expect(await takeReturn()).toBe(TARGET);
  });
});
