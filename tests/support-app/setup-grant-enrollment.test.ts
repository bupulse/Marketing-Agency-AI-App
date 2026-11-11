import { beforeEach, describe, expect, it, vi } from "vitest";

// Adding an authenticator: needs an emailed code, unless the admin made the account (or asked for a new app) and the
// one-time permission is still valid (app/support/(auth)/actions.ts startAgentEnrollment / confirmAgentEnrollment).
const h = vi.hoisted(() => ({
  appMetadata: {} as Record<string, unknown>,
  methods: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }] as unknown[],
  hasVerifiedTotp: false,
  enroll: vi.fn(async () => ({ data: { id: "factor-1", totp: { qr_code: "qr", secret: "s" } }, error: null })),
  challengeAndVerify: vi.fn(async () => ({ error: null })),
  clearSetupGrant: vi.fn(async () => {}),
  rateLimit: vi.fn(async () => {}),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error(`redirect:${url}`), { url }); } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: h.rateLimit, RateLimitError: class extends Error {} }));
vi.mock("@/lib/request-limits", () => ({ padTo: async () => {}, publicLimited: async () => null, requestIp: async () => null }));
vi.mock("@/lib/admin/service-keys", () => ({ loadServiceKeys: async () => {} }));
vi.mock("@/lib/auth/authenticator-sign-in", () => ({ signInWithAuthenticatorCode: vi.fn() }));
vi.mock("@/lib/widget/turnstile", () => ({ turnstileEnabled: () => false, verifyTurnstile: vi.fn() }));
vi.mock("@/lib/support/agents", () => ({ requestToJoin: vi.fn(), sendAgentPasswordReset: vi.fn(), clearSetupGrant: h.clearSetupGrant }));
vi.mock("@/lib/support/owner", () => ({ ensureOwnerAgent: vi.fn(), isSupportOwnerEmail: () => false }));
vi.mock("@/lib/db", () => ({ prisma: { supportAgent: { findUnique: vi.fn() }, staffMember: { findUnique: vi.fn(async () => null) } } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/support/app-auth", () => ({
  agentFor: vi.fn(),
  supportUrl: async (p: string) => p,
  requireAgentIdentity: async () => ({
    agent: { id: "ag1", email: "aline@example.com" },
    userId: "u1",
    methods: h.methods,
    hasVerifiedTotp: h.hasVerifiedTotp,
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: "u1", app_metadata: h.appMetadata } } }),
        mfa: {
          listFactors: async () => ({ data: { all: [{ id: "factor-1", status: "unverified", friendly_name: "x" }], totp: [] } }),
          unenroll: vi.fn(),
          enroll: h.enroll,
          challengeAndVerify: h.challengeAndVerify,
        },
      },
    },
  }),
}));

import { confirmAgentEnrollment, startAgentEnrollment } from "@/app/support/(auth)/actions";
import { SETUP_GRANT_KEY, setupGrantUntil } from "@/lib/support/setup-grant";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeEach(() => {
  h.appMetadata = {};
  h.hasVerifiedTotp = false;
  h.enroll.mockClear();
  h.clearSetupGrant.mockClear();
});

describe("adding an authenticator after a password sign-in", () => {
  it("is refused without an emailed code or a setup permission (a password alone cannot add one)", async () => {
    expect(await startAgentEnrollment()).toMatchObject({ needEmail: true });
    expect(h.enroll).not.toHaveBeenCalled();
  });

  it("is refused when the permission has run out", async () => {
    h.appMetadata = { [SETUP_GRANT_KEY]: "2020-01-01T00:00:00.000Z" };
    expect(await startAgentEnrollment()).toMatchObject({ needEmail: true });
  });

  it("works with a valid permission, and the permission is used up once the app is added", async () => {
    h.appMetadata = { [SETUP_GRANT_KEY]: setupGrantUntil() };
    expect(await startAgentEnrollment()).toMatchObject({ factorId: "factor-1", qr: "qr" });
    await expect(confirmAgentEnrollment({}, form({ factorId: "factor-1", code: "123456" }))).rejects.toMatchObject({ url: "/" });
    expect(h.clearSetupGrant).toHaveBeenCalledWith("u1");
  });

  it("never replaces an authenticator that is already set up", async () => {
    h.appMetadata = { [SETUP_GRANT_KEY]: setupGrantUntil() };
    h.hasVerifiedTotp = true;
    await expect(startAgentEnrollment()).rejects.toMatchObject({ url: "/verify" });
    expect(h.enroll).not.toHaveBeenCalled();
  });
});
