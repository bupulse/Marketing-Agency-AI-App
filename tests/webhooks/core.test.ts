import { describe, expect, it } from "vitest";
import { checkWebhookUrl, localTestAllowed } from "@/lib/webhooks/core";
import { buildPayload, isWebhookEvent } from "@/lib/webhooks/events";
import { validateEndpointInput, WebhookError } from "@/lib/webhooks/endpoints";

describe("SSRF guard for endpoints", () => {
  it.each(["http://hooks.zapier.com/x", "https://127.0.0.1/x", "https://169.254.169.254/latest", "https://10.0.0.5/x", "https://localhost/x", "https://hooks.zapier.com:8443/x"])("rejects %s", (url) => {
    expect(checkWebhookUrl(url).ok).toBe(false);
    expect(() => validateEndpointInput({ url, events: ["lead.created"] })).toThrow(WebhookError);
  });
  it("accepts a normal https address and normalises events", () => {
    expect(validateEndpointInput({ url: "https://hooks.zapier.com/hooks/catch/1/a/", events: ["lead.created", "lead.created", "bogus", "post.failed"] })).toEqual({
      url: "https://hooks.zapier.com/hooks/catch/1/a/",
      events: ["lead.created", "post.failed"],
    });
    expect(() => validateEndpointInput({ url: "https://hooks.zapier.com/x", events: ["nope"] })).toThrow(/at least one event/);
  });
});

describe("test-only local allowance", () => {
  const local = new URL("http://127.0.0.1:4555/hook");
  it("is off unless the flag is set", () => {
    expect(localTestAllowed(local, { NEXT_PUBLIC_SITE_URL: "http://localhost:3730" })).toBe(false);
  });
  it("works when the flag is set and the site itself is localhost", () => {
    const env = { BUPULSE_TEST_ALLOW_LOCAL_WEBHOOKS: "1", NEXT_PUBLIC_SITE_URL: "http://localhost:3730" };
    expect(localTestAllowed(local, env)).toBe(true);
    expect(localTestAllowed(new URL("http://10.0.0.1/x"), env)).toBe(false); // other private addresses stay blocked
    expect(localTestAllowed(new URL("http://169.254.169.254/x"), env)).toBe(false);
  });
  it("is ignored on a real site address, even with the flag set", () => {
    expect(localTestAllowed(local, { BUPULSE_TEST_ALLOW_LOCAL_WEBHOOKS: "1", NEXT_PUBLIC_SITE_URL: "https://bupulse.com" })).toBe(false);
    expect(localTestAllowed(local, { BUPULSE_TEST_ALLOW_LOCAL_WEBHOOKS: "1" })).toBe(false);
  });
});

describe("the test allowance is for webhook delivery only", () => {
  it("checkWebhookUrl ignores it unless the caller opts in, so store and image fetchers never get it", () => {
    const saved = { ...process.env };
    process.env.BUPULSE_TEST_ALLOW_LOCAL_WEBHOOKS = "1";
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3730";
    try {
      expect(checkWebhookUrl("http://127.0.0.1:4555/x").ok).toBe(false);
      expect(checkWebhookUrl("http://127.0.0.1:4555/x", { allowLocalTest: false }).ok).toBe(false);
      expect(checkWebhookUrl("http://127.0.0.1:4555/x", { allowLocalTest: true }).ok).toBe(true);
    } finally {
      process.env = saved;
    }
  });
});

describe("payloads", () => {
  it("wraps data under the event's key with business and time", () => {
    const now = new Date("2026-10-08T10:00:00Z");
    expect(buildPayload("lead.created", { id: "l1" }, { id: "b1", name: "Biz" }, now)).toEqual({ event: "lead.created", lead: { id: "l1" }, business: { id: "b1", name: "Biz" }, createdAt: now.toISOString() });
    expect(buildPayload("post.failed", { id: "p1" }, { id: "b1", name: "Biz" }, now)).toHaveProperty("post");
    expect(buildPayload("content.generated", {}, { id: "b1", name: "Biz" }, now)).toHaveProperty("content");
    expect(isWebhookEvent("post.published")).toBe(true);
    expect(isWebhookEvent("webhook.test")).toBe(false);
  });
});
