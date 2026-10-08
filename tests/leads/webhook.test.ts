import { describe, expect, it, vi } from "vitest";
import { checkWebhookUrl, deliverWebhook, generateWebhookSecret, isBlockedHost, signWebhook, verifyWebhookSignature } from "@/lib/leads/webhook";

describe("signing", () => {
  it("signs `${t}.${body}` with HMAC-SHA256 and verifies", async () => {
    const header = await signWebhook("whsec_abc", '{"a":1}', 1_800_000_000);
    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    // Known answer, computed independently with node:crypto.
    const { createHmac } = await import("node:crypto");
    expect(header.split("v1=")[1]).toBe(createHmac("sha256", "whsec_abc").update('1800000000.{"a":1}').digest("hex"));
    expect(await verifyWebhookSignature("whsec_abc", '{"a":1}', header, 300, 1_800_000_100_000)).toBe(true);
    expect(await verifyWebhookSignature("whsec_abc", '{"a":2}', header, 300, 1_800_000_100_000)).toBe(false);
    expect(await verifyWebhookSignature("other", '{"a":1}', header, 300, 1_800_000_100_000)).toBe(false);
    expect(await verifyWebhookSignature("whsec_abc", '{"a":1}', header, 300, 1_800_001_000_000)).toBe(false);
  });
  it("makes distinct secrets", () => {
    expect(generateWebhookSecret()).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});

describe("SSRF guard", () => {
  it.each([
    "http://example.org/hook", "https://localhost/x", "https://foo.localhost/x", "https://127.0.0.1/x", "https://2130706433/x",
    "https://0x7f.0.0.1/x", "https://10.1.2.3/x", "https://172.16.0.1/x", "https://172.31.255.255/x", "https://192.168.1.1/x",
    "https://169.254.169.254/latest/meta-data", "https://100.64.0.1/x", "https://0.0.0.0/x", "https://[::1]/x", "https://[fe80::1]/x",
    "https://[fd00::1]/x", "https://[::ffff:127.0.0.1]/x", "https://[::ffff:10.0.0.1]/x", "https://intranet/x", "https://db.internal/x",
    "https://printer.local/x", "https://user:pw@hooks.zapier.com/x", "https://hooks.zapier.com:8443/x", "ftp://hooks.zapier.com/x", "not a url",
  ])("blocks %s", (url) => {
    expect(checkWebhookUrl(url).ok).toBe(false);
  });
  it.each(["https://hooks.zapier.com/hooks/catch/1/abc", "https://hook.eu1.make.com/xyz", "https://api.mycrm.co.rw:443/leads", "https://8.8.8.8/x"])("allows %s", (url) => {
    expect(checkWebhookUrl(url).ok).toBe(true);
  });
  it("tells public and private apart", () => {
    expect(isBlockedHost("172.32.0.1")).toBe(false);
    expect(isBlockedHost("172.15.0.1")).toBe(false);
    expect(isBlockedHost("[2606:4700::1111]")).toBe(false);
  });
});

const ok = () => new Response("ok", { status: 200 });
const base = { url: "https://hooks.example.com/a", secret: "s", event: "lead.created", body: "{}", sleep: async () => {} };

describe("delivery", () => {
  it("posts signed JSON once on success", async () => {
    const fetchImpl = vi.fn(async () => ok());
    const result = await deliverWebhook({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ ok: true, attempts: 1, status: 200 });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(headers["x-bupulse-signature"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(headers["x-bupulse-event"]).toBe("lead.created");
  });
  it("retries 5xx twice (3 attempts) then gives up", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 502 }));
    const sleep = vi.fn(async (ms: number) => void ms);
    const result = await deliverWebhook({ ...base, sleep, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ ok: false, attempts: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 4000]);
  });
  it("recovers after a network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new TypeError("down")).mockResolvedValueOnce(ok());
    expect(await deliverWebhook({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch })).toMatchObject({ ok: true, attempts: 2 });
  });
  it("does not retry other 4xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
    expect(await deliverWebhook({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch })).toMatchObject({ ok: false, attempts: 1, status: 404 });
  });
  it("never fetches a blocked url", async () => {
    const fetchImpl = vi.fn();
    const result = await deliverWebhook({ ...base, url: "https://127.0.0.1/x", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("follows a safe redirect but refuses one to a private address", async () => {
    const safe = vi.fn().mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "https://other.example.com/b" } })).mockResolvedValueOnce(ok());
    expect(await deliverWebhook({ ...base, fetchImpl: safe as unknown as typeof fetch })).toMatchObject({ ok: true });
    expect(safe).toHaveBeenCalledTimes(2);

    const evil = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest" } }));
    const result = await deliverWebhook({ ...base, fetchImpl: evil as unknown as typeof fetch });
    expect(result.ok).toBe(false);
    expect(evil).toHaveBeenCalledTimes(1);
  });
});
