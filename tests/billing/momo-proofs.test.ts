import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

// Proof of a Mobile Money payment (docs/MOMO.md, "Proof"): the screenshot upload is tied to the client's own open
// payment, checked by its first bytes, stored privately and shown to the owner; "I can't find the transaction id"
// needs the screenshot and the owner then types the id, which the replay guard still covers.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  sendEmail: vi.fn(async () => true),
  trackEvent: vi.fn(),
  files: new Map<string, Uint8Array>(),
  types: new Map<string, string>(),
  removed: [] as string[],
  uploads: [] as string[],
}));

vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: h.sendEmail }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: {}, trackEvent: h.trackEvent }));
// The private bucket, in memory: what the browser uploaded is in `files`.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: (bucket: string) => {
        if (bucket !== "payment-proofs") throw new Error(`unexpected bucket ${bucket}`);
        return {
          createSignedUploadUrl: async (path: string) => (h.uploads.push(path), { data: { path, token: `tok-${path}`, signedUrl: "https://x" }, error: null }),
          download: async (path: string) => {
            const bytes = h.files.get(path);
            return bytes ? { data: new Blob([bytes as BlobPart]), error: null } : { data: null, error: { message: "not found" } };
          },
          // The server's own copy: never overwrites (upsert off), like Storage.
          upload: async (path: string, body: Blob, opts: { upsert?: boolean; contentType?: string }) => {
            if (h.files.has(path) && !opts.upsert) return { data: null, error: { message: "exists" } };
            h.files.set(path, new Uint8Array(await body.arrayBuffer()));
            h.types.set(path, String(opts.contentType));
            return { data: { path }, error: null };
          },
          remove: async (paths: string[]) => (h.removed.push(...paths), paths.forEach((p) => h.files.delete(p)), { error: null }),
          createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/${path}?token=t` }, error: null }),
        };
      },
    },
  }),
}));

import { resetPlanCache } from "@/lib/plan-catalog";
import { AdminError, consoleContext } from "@/lib/admin/types";
import * as momo from "@/lib/billing/momo";
import { readProofObject } from "@/lib/billing/momo-proofs";
import { clearMomoSettingsCache } from "@/lib/billing/momo-settings";
import { MOMO_SETTING_KEY } from "@/lib/billing/momo-shared";
import { resetRegionCache } from "@/lib/region";
import { resetRegionPriceCache } from "@/lib/region-prices";

const CONSOLE = consoleContext("198.51.100.1");
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-14T10:00:00Z");
const msg = async (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);
const code = async (p: Promise<unknown>) => p.then(() => null, (e: AdminError) => e.code);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");

function seed() {
  for (const [id, name] of [[USER, "Inzu Fashion"], [OTHER, "Other Ltd"]] as const) {
    h.db.user.rows.push({ id, email: `${id.slice(0, 4)}@example.rw`, name: "Aline", suspendedAt: null });
    h.db.business.rows.push({ id: `biz-${id.slice(0, 4)}`, userId: id, name, ceoName: "Aline", pricingRegion: "RW" });
    h.db.subscription.rows.push({ id: `s-${id.slice(0, 4)}`, userId: id, plan: "TRIAL", status: "TRIALING", provider: null, providerCustomerId: null, providerSubscriptionId: null, providerPriceId: null, interval: "MONTH", cancelAtPeriodEnd: false, trialEndsAt: new Date("2026-10-17T00:00:00Z"), currentPeriodStart: new Date("2026-10-10T00:00:00Z"), currentPeriodEnd: null });
  }
  h.db.planRegionPrice.rows.push({ id: "prp_std", planKey: "STANDARD", regionKey: "RW", currency: "RWF", monthlyMinor: 15000, yearlyMinor: 150000 });
  h.db.adminSetting.rows.push({ key: MOMO_SETTING_KEY, value: { merchantCode: "002450", accountName: "BuPulse" } });
}

const start = (userId = USER) => momo.startManualPayment({ userId, plan: "STANDARD", interval: "MONTH", now: NOW });
/** The browser's upload: ask for the URL, then put the bytes there. */
async function upload(paymentId: string, bytes: Uint8Array, type = "image/png", userId = USER) {
  const target = await momo.startProofUpload(userId, { paymentId, type, bytes: bytes.length });
  h.files.set(target.path, bytes);
  return target.path;
}
const submit = (paymentId: string, over: Record<string, unknown> = {}, userId = USER) =>
  momo.submitManualProof(userId, { paymentId, transactionId: "MP1234567", payerPhone: "078 123 4567", network: "MTN", ...over }, NOW);

beforeEach(() => {
  h.db = createFakeDb();
  h.files.clear();
  h.types.clear();
  h.removed.length = 0;
  h.uploads.length = 0;
  vi.clearAllMocks();
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
  clearMomoSettingsCache();
  process.env.ADMIN_EMAILS = "owner@bupulse.com";
  process.env.RESEND_API_KEY = "re_test";
  seed();
});

describe("the screenshot upload", () => {
  it("is issued only for the client's own open, unsubmitted payment, as a JPEG, PNG or WebP up to 5 MB", async () => {
    const p = await start();
    expect(await msg(momo.startProofUpload(USER, { paymentId: p.id, type: "image/heic", bytes: 1000 }))).toMatch(/JPEG, PNG or WebP/);
    expect(await msg(momo.startProofUpload(USER, { paymentId: p.id, type: "image/png", bytes: 5 * 1024 * 1024 + 1 }))).toMatch(/at most 5 MB/);
    expect(await msg(momo.startProofUpload(USER, { paymentId: p.id, type: "image/png", bytes: 0 }))).toMatch(/empty/);
    // Another company's payment is not found, whatever its id.
    expect(await msg(momo.startProofUpload(OTHER, { paymentId: p.id, type: "image/png", bytes: 1000 }))).toMatch(/could not find that payment/);
    expect(h.uploads).toHaveLength(0);

    const target = await momo.startProofUpload(USER, { paymentId: p.id, type: "image/png", bytes: 1000 });
    expect(target.path).toMatch(new RegExp(`^${USER}/${p.id}/[0-9a-f-]{36}\\.png$`));
    expect(h.db.manualPayment.rows[0].proofPath).toBe(target.path);
    // A second upload replaces the first: the old file goes, only the new path is on the payment.
    const again = await momo.startProofUpload(USER, { paymentId: p.id, type: "image/jpeg", bytes: 1000 });
    expect(again.path).toMatch(/\.jpg$/);
    expect(h.removed).toEqual([target.path]);
    expect(h.db.manualPayment.rows[0].proofPath).toBe(again.path);
  });

  it("is refused once the payment is sent for approval", async () => {
    const p = await start();
    await submit(p.id);
    expect(await msg(momo.startProofUpload(USER, { paymentId: p.id, type: "image/png", bytes: 1000 }))).toMatch(/already sent/);
  });
});

describe("I have paid, with a screenshot", () => {
  it("attaches the server's own copy of the checked bytes (the client's upload is removed, so it cannot be changed afterwards)", async () => {
    const p = await start();
    const path = await upload(p.id, PNG);
    const view = await submit(p.id, { proofPath: path });
    expect(view).toMatchObject({ submitted: true, transactionId: "MP1234567", proofType: "image/png" });
    expect(h.db.manualPayment.rows[0]).toMatchObject({ proofPath: `verified/${path}`, proofBytes: PNG.length, proofType: "image/png" });
    expect(h.files.get(`verified/${path}`)).toEqual(PNG);
    expect(h.types.get(`verified/${path}`)).toBe("image/png");
    // The upload token's path is gone: re-uploading there changes nothing the owner sees.
    expect(h.files.has(path)).toBe(false);
    h.files.set(path, HTML);
    expect(h.files.get(`verified/${path}`)).toEqual(PNG);
  });

  it("refuses a file that is not an image by its first bytes (and deletes it), whatever it was called", async () => {
    const p = await start();
    const path = await upload(p.id, HTML, "image/png");
    expect(await msg(submit(p.id, { proofPath: path }))).toMatch(/not a JPEG, PNG or WebP/);
    expect(h.removed).toContain(path);
    expect(h.db.manualPayment.rows[0].submittedAt).toBeNull();
  });

  it("refuses a path the server did not issue for this payment: another payment's, another client's, or made up", async () => {
    const mine = await start();
    const theirs = await start(OTHER);
    const theirPath = await upload(theirs.id, PNG, "image/png", OTHER);
    // The other company's screenshot cannot be attached to my payment.
    expect(await msg(submit(mine.id, { proofPath: theirPath }))).toMatch(/not the one uploaded/);
    // A path of my own folder that was never issued.
    h.files.set(`${USER}/${mine.id}/00000000-0000-4000-8000-000000000000.png`, PNG);
    expect(await msg(submit(mine.id, { proofPath: `${USER}/${mine.id}/00000000-0000-4000-8000-000000000000.png` }))).toMatch(/not the one uploaded/);
    expect(await msg(submit(mine.id, { proofPath: "../../etc/passwd" }))).toMatch(/not the one uploaded/);
    expect(h.db.manualPayment.rows.find((r) => r.id === mine.id)?.submittedAt).toBeNull();
  });

  it("a screenshot that never arrived is refused; one uploaded and then left out is not kept", async () => {
    const p = await start();
    const target = await momo.startProofUpload(USER, { paymentId: p.id, type: "image/jpeg", bytes: JPEG.length });
    expect(await msg(submit(p.id, { proofPath: target.path }))).toMatch(/did not arrive/);
    h.files.set(target.path, JPEG);
    await submit(p.id); // the form was sent without the screenshot
    expect(h.db.manualPayment.rows[0]).toMatchObject({ proofPath: null, proofBytes: null });
    expect(h.removed).toContain(target.path);
  });

  it("I can't find the transaction id: the screenshot is then required, and the payment waits with no id", async () => {
    const p = await start();
    expect(await msg(submit(p.id, { transactionId: null, noTransactionId: true }))).toMatch(/add a screenshot/);
    const path = await upload(p.id, JPEG, "image/jpeg");
    const view = await submit(p.id, { transactionId: null, noTransactionId: true, proofPath: path });
    expect(view).toMatchObject({ submitted: true, transactionId: null, proofType: "image/jpeg" });
    // The owner's alert says so instead of an id.
    expect(JSON.stringify(h.sendEmail.mock.calls)).toContain("not found by the client");
  });
});

describe("the owner confirms with the screenshot", () => {
  async function waitingWithoutId() {
    const p = await start();
    const path = await upload(p.id, PNG);
    await submit(p.id, { transactionId: null, noTransactionId: true, proofPath: path });
    return { p, path };
  }

  it("lists the screenshot for the console (signed link) and needs the transaction id typed when the client had none", async () => {
    const { p, path } = await waitingWithoutId();
    const listed = (await momo.listManualPayments({ status: "pending" }, NOW)).items[0];
    expect(listed).toMatchObject({ id: p.id, proofPath: `verified/${path}`, proofType: "image/png", transactionId: null });
    expect(await readProofObject(`verified/${path}`)).toEqual({ bytes: PNG, type: "image/png" });

    expect(await msg(momo.confirmManualPayment(CONSOLE, p.id, NOW))).toMatch(/type it from your Mobile Money message/);
    expect(await code(momo.confirmManualPayment(CONSOLE, p.id, NOW, { transactionId: "x" }))).toBe("invalid");
    const done = await momo.confirmManualPayment(CONSOLE, p.id, NOW, { transactionId: "MP9990001" });
    expect(done).toMatchObject({ status: "confirmed", plan: "STANDARD" });
    // Activated exactly as before, and the id the owner typed is on the payment, the money event and the audit.
    expect(h.db.subscription.rows[0]).toMatchObject({ plan: "STANDARD", status: "ACTIVE", provider: "MANUAL_MOMO" });
    expect(h.db.manualPayment.rows[0]).toMatchObject({ status: "confirmed", transactionId: "MP9990001" });
    expect(JSON.stringify(h.db.billingEvent.rows[0].payload)).toContain("MP9990001");
    const audit = h.db.auditLog.rows.find((a) => a.action === "confirm_momo_payment");
    expect(audit?.after).toMatchObject({ transactionId: "MP9990001", transactionIdBy: "admin", screenshot: true });
  });

  it("the replay guard covers the typed id: one already confirmed on another payment is refused, nothing changes", async () => {
    const { p } = await waitingWithoutId();
    h.db.manualPayment.rows.push({ id: "old", userId: OTHER, planKey: "STANDARD", interval: "MONTH", amountMinor: 15000, reference: "BP-OLD2", status: "confirmed", network: "MTN", transactionId: "mp9990001", submittedAt: NOW, createdAt: new Date("2026-10-01T00:00:00Z") });
    expect(await msg(momo.confirmManualPayment(CONSOLE, p.id, NOW, { transactionId: "MP9990001" }))).toMatch(/already used on another payment/);
    expect(h.db.manualPayment.rows[0]).toMatchObject({ status: "pending", transactionId: null });
    expect(h.db.subscription.rows[0].status).toBe("TRIALING");
  });

  it("a payment the client gave an id for ignores a typed one (the client's id is the one checked)", async () => {
    const p = await start();
    await submit(p.id);
    await momo.confirmManualPayment(CONSOLE, p.id, NOW, { transactionId: "SOMETHINGELSE" });
    expect(h.db.manualPayment.rows[0]).toMatchObject({ status: "confirmed", transactionId: "MP1234567" });
  });

  it("the client's replay guard still refuses an id used by a live payment of another company", async () => {
    const theirs = await start(OTHER);
    await submit(theirs.id, {}, OTHER);
    const mine = await start();
    expect(await msg(submit(mine.id))).toMatch(/already been used/);
  });
});

describe("clean-up", () => {
  it("screenshots of payments never submitted (cancelled, replaced, closed) are removed; submitted ones are kept", async () => {
    const p = await start();
    const path = await upload(p.id, PNG);
    expect(await momo.cancelManualPayment(USER, p.id, NOW)).toBe(true);
    const kept = await start(OTHER);
    const keptPath = await upload(kept.id, PNG, "image/png", OTHER);
    await submit(kept.id, { proofPath: keptPath }, OTHER);
    h.removed.length = 0;
    expect(await momo.sweepUnsubmittedProofs()).toBe(1);
    expect(h.removed).toEqual([path]);
    expect(h.files.has(`verified/${keptPath}`)).toBe(true);
    expect(h.db.manualPayment.rows.find((r) => r.id === p.id)).toMatchObject({ proofPath: null });
    expect(h.db.manualPayment.rows.find((r) => r.id === kept.id)).toMatchObject({ proofPath: `verified/${keptPath}` });
    expect(await momo.sweepUnsubmittedProofs()).toBe(0);
  });
});
