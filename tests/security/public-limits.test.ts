import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 9 (M1, L4): the signed-out entry points are limited per client address and per normalised email, checkEmail
// answers the same way (and in the same time) once limited, and sign-up needs Turnstile when its keys are set.

const h = vi.hoisted(() => ({
  ip: "203.0.113.7" as string | null,
  rateLimit: vi.fn<(key: string, rule: unknown) => Promise<void>>(async () => {}),
  existing: null as null | { method: string; hasPassword?: boolean },
  signIn: vi.fn(async () => ({ error: null as null | { code?: string; status?: number } })),
  signUp: vi.fn(async () => ({ data: { user: { identities: [{}] } }, error: null })),
  resend: vi.fn(async () => ({ error: null })),
  reset: vi.fn(async () => ({ error: null })),
  createContact: vi.fn(async () => ({})),
  fetch: vi.fn(),
}));

const { RateLimitError } = vi.hoisted(() => ({
  RateLimitError: class RateLimitError extends Error {
    constructor(public retryAfterSeconds: number) {
      super("Too many requests");
    }
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(h.ip ? { "cf-connecting-ip": h.ip, "x-forwarded-for": "198.51.100.99" } : {}),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: h.rateLimit,
  RateLimitError,
  rateLimitMessage: (e: InstanceType<typeof RateLimitError>) => `You're doing that a lot. Please try again in ${Math.ceil(e.retryAfterSeconds / 60)} minutes.`,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithPassword: h.signIn, signUp: h.signUp, resend: h.resend, resetPasswordForEmail: h.reset } }),
}));
vi.mock("@/lib/account", () => ({ findAccountByEmail: vi.fn(async () => h.existing) }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/industries/server", () => ({ resolveIndustryChoice: async () => ({ industry: "Shops & retail", industryId: "ind1", industryOther: null, industryDescription: "We sell shoes in Kigali." }) }));
vi.mock("@/lib/auth/return-server", () => ({ rememberReturn: vi.fn(async () => {}) }));
vi.mock("@/lib/db", () => ({ prisma: { contactRequest: { findFirst: vi.fn(async () => null), create: h.createContact } } }));

import { checkEmail, resendConfirmation, signUp } from "@/app/signup/actions";
import { signInWithPassword } from "@/app/login/actions";
import { requestPasswordReset } from "@/app/forgot-password/actions";
import { submitContactRequest } from "@/lib/contact";
import { findAccountByEmail } from "@/lib/account";
import { clientIpFrom, normalizeEmail, PUBLIC_LIMITS } from "@/lib/request-limits";

const keys = () => h.rateLimit.mock.calls.map((c) => c[0]);
const limitNext = (n = 1) => {
  for (let i = 0; i < n; i++) h.rateLimit.mockRejectedValueOnce(new RateLimitError(600));
};

function signUpForm(over: Record<string, string> = {}) {
  const f = new FormData();
  const v = { email: "Aline+shop@Example.com", organisationName: "Inzu", ceoName: "Aline", industry: "shops", industryDescription: "We sell shoes in Kigali.", country: "Rwanda", phone: "", website: "", password: "Kigali-Shoes-2026!", confirmPassword: "Kigali-Shoes-2026!", terms: "true", ...over };
  for (const [k, val] of Object.entries(v)) f.set(k, val);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.ip = "203.0.113.7";
  h.existing = null;
  h.rateLimit.mockImplementation(async () => {});
  h.signIn.mockResolvedValue({ error: null });
  vi.stubEnv("TURNSTILE_SITE_KEY", "");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  vi.stubGlobal("fetch", h.fetch);
});

describe("helpers", () => {
  it("reads cf-connecting-ip first, then the first x-forwarded-for hop", () => {
    expect(clientIpFrom(new Headers({ "cf-connecting-ip": " 203.0.113.1 ", "x-forwarded-for": "10.0.0.1" }))).toBe("203.0.113.1");
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "198.51.100.2, 10.0.0.1" }))).toBe("198.51.100.2");
    expect(clientIpFrom(new Headers())).toBeNull();
  });

  it("normalises an email to one mailbox (case, spaces, +tag)", () => {
    expect(normalizeEmail("  Aline+Promo@Example.COM ")).toBe("aline@example.com");
    expect(normalizeEmail("aline@example.com")).toBe("aline@example.com");
    expect(normalizeEmail("not-an-email")).toBe("not-an-email");
  });
});

describe("checkEmail", () => {
  it("counts per IP and per address, without storing either in the key", async () => {
    await checkEmail("aline@example.com");
    expect(h.rateLimit).toHaveBeenCalledWith(expect.stringMatching(/^public:checkEmail:ip:[0-9a-f]{32}$/), PUBLIC_LIMITS.checkEmail.ip);
    expect(h.rateLimit).toHaveBeenCalledWith(expect.stringMatching(/^public:checkEmail:email:[0-9a-f]{32}$/), PUBLIC_LIMITS.checkEmail.email);
    expect(keys().join(" ")).not.toMatch(/203\.0\.113\.7|aline|example/);
  });

  it("a +tag or capitals do not get a fresh email counter", async () => {
    await checkEmail("aline@example.com");
    await checkEmail("ALINE+2@example.com");
    const emailKeys = keys().filter((k) => k.includes(":email:"));
    expect(emailKeys[0]).toBe(emailKeys[1]);
  });

  it("once limited answers 'not registered' without looking the address up, so it is no oracle", async () => {
    h.existing = { method: "PASSWORD" };
    expect(await checkEmail("aline@example.com")).toMatchObject({ registered: true });
    limitNext(2);
    expect(await checkEmail("aline@example.com")).toEqual({ registered: false });
    expect(findAccountByEmail).toHaveBeenCalledTimes(1);
  });

  it("takes the same minimum time for a known and an unknown address", async () => {
    const t0 = Date.now();
    await checkEmail("nobody@example.com");
    const unknown = Date.now() - t0;
    h.existing = { method: "PASSWORD" };
    const t1 = Date.now();
    await checkEmail("aline@example.com");
    const known = Date.now() - t1;
    expect(unknown).toBeGreaterThanOrEqual(380);
    expect(known).toBeGreaterThanOrEqual(380);
  });
});

describe("sign-up, resend, login and password reset", () => {
  it("sign-up is limited per IP and per address before Supabase is called", async () => {
    expect(await signUp({ status: "idle" }, signUpForm())).toEqual({ status: "sent", email: "aline+shop@example.com" });
    expect(keys()).toEqual([expect.stringMatching(/^public:signUp:ip:/), expect.stringMatching(/^public:signUp:email:/)]);
    limitNext();
    expect(await signUp({ status: "idle" }, signUpForm())).toEqual({ status: "error", message: expect.stringMatching(/doing that a lot/) });
    expect(h.signUp).toHaveBeenCalledTimes(1);
  });

  it("sign-up needs a valid Turnstile token when the keys are set, and sends the client address to Cloudflare", async () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "site");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    expect(await signUp({ status: "idle" }, signUpForm())).toEqual({ status: "error", message: expect.stringMatching(/security check/) });
    expect(h.fetch).not.toHaveBeenCalled(); // no token: refused without a call
    h.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: false }), { status: 200 }));
    expect(await signUp({ status: "idle" }, signUpForm({ turnstileToken: "bad" }))).toMatchObject({ status: "error" });
    h.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    expect(await signUp({ status: "idle" }, signUpForm({ turnstileToken: "good" }))).toMatchObject({ status: "sent" });
    const body = h.fetch.mock.calls[1][1].body as URLSearchParams;
    expect(body.get("response")).toBe("good");
    expect(body.get("remoteip")).toBe("203.0.113.7");
    expect(h.signUp).toHaveBeenCalledTimes(1);
  });

  it("without Turnstile keys, sign-up runs on the limits alone", async () => {
    expect(await signUp({ status: "idle" }, signUpForm())).toMatchObject({ status: "sent" });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("resending the confirmation is limited per IP and per address", async () => {
    expect(await resendConfirmation("aline@example.com")).toEqual({});
    limitNext();
    expect(await resendConfirmation("aline@example.com")).toEqual({ error: expect.stringMatching(/doing that a lot/), retrySeconds: 60 });
    expect(h.resend).toHaveBeenCalledTimes(1);
  });

  it("login is limited per IP and per address before the password is tried", async () => {
    await expect(signInWithPassword({}, Object.assign(new FormData(), {}) as FormData)).resolves.toMatchObject({ fieldErrors: expect.any(Object) });
    const f = new FormData();
    f.set("email", "aline@example.com");
    f.set("password", "x");
    await expect(signInWithPassword({}, f)).rejects.toThrow(/REDIRECT/);
    expect(keys()).toEqual([expect.stringMatching(/^public:login:ip:/), expect.stringMatching(/^public:login:email:/)]);
    h.rateLimit.mockImplementationOnce(async () => {}).mockRejectedValueOnce(new RateLimitError(120));
    expect(await signInWithPassword({}, f)).toEqual({ error: expect.stringMatching(/doing that a lot/) });
    expect(h.signIn).toHaveBeenCalledTimes(1);
  });

  it("password reset is limited, with the same answer whether or not the address has an account", async () => {
    const f = new FormData();
    f.set("email", "aline@example.com");
    expect(await requestPasswordReset({}, f)).toEqual({ sent: true, email: "aline@example.com" });
    limitNext();
    const limited = await requestPasswordReset({}, f);
    h.existing = { method: "PASSWORD" };
    limitNext();
    expect(await requestPasswordReset({}, f)).toEqual(limited);
    expect(h.reset).toHaveBeenCalledTimes(1);
  });

  it("without cf-connecting-ip (local dev) the first x-forwarded-for hop is the key", async () => {
    h.ip = null;
    await checkEmail("aline@example.com");
    const withoutIp = keys()[0];
    h.ip = "203.0.113.7";
    await checkEmail("aline@example.com");
    expect(keys()[2]).not.toBe(withoutIp);
  });
});

describe("contact form", () => {
  it("is limited per client address; the honeypot still answers success without counting", async () => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ kind: "contact", name: "Aline", email: "aline@example.com", message: "Hello, I would like a demo." })) f.set(k, v);
    expect(await submitContactRequest(f)).toEqual({ status: "success" });
    expect(h.rateLimit).toHaveBeenCalledWith(expect.stringMatching(/^public:contact:ip:/), PUBLIC_LIMITS.contact.ip);
    limitNext();
    const limited = await submitContactRequest(f);
    expect(limited).toMatchObject({ status: "error", errors: { form: expect.stringMatching(/doing that a lot/) }, values: { name: "Aline" } });
    expect(h.createContact).toHaveBeenCalledTimes(1);
    h.rateLimit.mockClear();
    const bot = new FormData();
    bot.set("website", "spam.example");
    expect(await submitContactRequest(bot)).toEqual({ status: "success" });
    expect(h.rateLimit).not.toHaveBeenCalled();
  });
});
