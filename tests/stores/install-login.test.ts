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
import { signInWithPassword } from "@/app/login/actions";
import { signUp } from "@/app/signup/actions";
import { GET as confirm } from "@/app/auth/confirm/route";
import { cleanReturn, hasReturn, RETURN_COOKIE } from "@/lib/auth/return-path";
import { readReturn, takeReturn } from "@/lib/auth/return-server";
import { countries } from "@/lib/content/countries";

const INSTALL = "/dashboard/stores/shopify?shop=my-shop.myshopify.com&hmac=abc123&host=YWRtaW4&timestamp=1700000000";

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

const login = (next: string) => {
  const f = new FormData();
  f.set("email", "a@b.co");
  f.set("password", "Password-12345");
  f.set("next", next);
  return signInWithPassword({}, f).then(() => "no redirect", (e: Error) => e.message);
};

describe("the install URL survives sign-in", () => {
  it("the proxy keeps the whole query when it sends a signed-out visitor to /login", async () => {
    const res = await proxy(new NextRequest(`https://app.bupulse.test${INSTALL}`));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(INSTALL);
    expect([...location.searchParams.keys()]).toEqual(["next"]); // the install query is only inside next, not repeated
  });

  it("login sends the merchant back to the install URL and remembers it for the sign-up steps", async () => {
    expect(await login(INSTALL)).toBe(`REDIRECT:${INSTALL}`);
    expect(jar.values.get(RETURN_COOKIE)).toBe(INSTALL);
    expect(jar.sets[0].options).toMatchObject({ httpOnly: true, sameSite: "lax" });
  });

  it("is not an open redirect: absolute, protocol-relative and backslash targets fall back to the dashboard", async () => {
    for (const bad of ["https://evil.example.org/x", "//evil.example.org", "/\\evil.example.org", "javascript:alert(1)", "/\t/evil.example.org"]) {
      expect(cleanReturn(bad)).toBe("/dashboard");
      expect(hasReturn(bad)).toBe(false);
      jar.values.clear();
      expect(await login(bad)).toBe("REDIRECT:/dashboard");
      expect(jar.values.has(RETURN_COOKIE)).toBe(false);
    }
    expect(cleanReturn(INSTALL)).toBe(INSTALL);
  });
});

describe("the install URL survives sign-up for brand-new users", () => {
  const signup = (next: string) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ email: "new@shop.co", organisationName: "Shop", ceoName: "Ann Lee", industry: "other", industryOther: "Corner shop", industryDescription: "A corner shop selling groceries and airtime in Kigali.", country: countries[0], phone: "", website: "", password: "Password-12345!", confirmPassword: "Password-12345!", terms: "true", next })) f.set(k, v);
    return signUp({ status: "idle" }, f);
  };

  it("puts the install URL in the confirmation email link", async () => {
    await signup(INSTALL);
    const link = mocks.signUp.mock.calls[0][0].options.emailRedirectTo as string;
    expect(new URL(link).pathname).toBe("/auth/confirm");
    expect(new URL(link).searchParams.get("next")).toBe(INSTALL);
  });

  it("an unsafe next in the sign-up form is replaced by the dashboard", async () => {
    await signup("https://evil.example.org");
    const link = mocks.signUp.mock.calls[0][0].options.emailRedirectTo as string;
    expect(new URL(link).searchParams.get("next")).toBe("/dashboard");
  });

  it("confirming the email lands on the install URL and sets the return cookie for /welcome and /onboarding", async () => {
    const res = await confirm(new NextRequest(`https://app.bupulse.test/auth/confirm?token_hash=t&type=signup&next=${encodeURIComponent(INSTALL)}`));
    expect(res.headers.get("location")).toBe(`https://app.bupulse.test${INSTALL}`);
    expect(res.headers.get("set-cookie")).toContain(`${RETURN_COOKIE}=`);
    const evil = await confirm(new NextRequest(`https://app.bupulse.test/auth/confirm?token_hash=t&type=signup&next=${encodeURIComponent("//evil.example.org")}`));
    expect(evil.headers.get("location")).toBe("https://app.bupulse.test/dashboard");
    expect(evil.headers.get("set-cookie")).toBeNull();
  });

  it("onboarding then returns to the install URL once (read keeps it, take clears it); junk cookies are ignored", async () => {
    jar.values.set(RETURN_COOKIE, INSTALL);
    expect(await readReturn()).toBe(INSTALL);
    expect(await takeReturn()).toBe(INSTALL);
    expect(await readReturn()).toBe("/dashboard");
    jar.values.set(RETURN_COOKIE, "https://evil.example.org");
    expect(await takeReturn()).toBe("/dashboard");
  });
});
