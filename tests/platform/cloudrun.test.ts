import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("not on Cloudflare");
  },
}));

import { CLOUDFLARE_RANGES, inRanges, parseIp } from "@/lib/platform/cidr";
import { currentPlatform } from "@/lib/platform/detect";
import { clientIp, cloudRunPeer, trustedClientIp, viaCloudflare, visitorCountry } from "@/lib/platform/headers";
import { keepAlive, waitUntil } from "@/lib/platform/background";
import { requestDatabase } from "@/lib/platform/database";
import { hasShortRequestLimit, publishTimingNote, timeBudget } from "@/lib/platform/limits";
import { geoFrom } from "@/lib/support/client-info";
import { DEPLOY_HOSTS, deployHost } from "@/lib/admin/deploy-host";
import { labPresentersAllowed } from "@/lib/training-lab/reader";
import { subscriptionAllowed } from "@/lib/image-engine/claude-cli";

const CF_EDGE = "172.70.1.2"; // inside 172.64.0.0/13
const VISITOR = "102.22.1.9"; // a Rwandan mobile address
const h = (headers: Record<string, string>) => new Headers(headers);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("CIDR ranges", () => {
  it("parses IPv4, IPv6 and IPv4-mapped IPv6", () => {
    expect(parseIp("1.2.3.4")).toEqual({ v: 4, n: BigInt(0x01020304) });
    expect(parseIp("::ffff:1.2.3.4")).toEqual({ v: 4, n: BigInt(0x01020304) });
    expect(parseIp("2606:4700::1")?.v).toBe(6);
    expect(parseIp("::1")?.n).toBe(BigInt(1));
  });

  it.each(["", "1.2.3", "1.2.3.256", "1.2.3.4.5", "abc", "1::2::3", "12345::", "2606:4700:0:0:0:0:0:0:1", "not an ip"])("rejects %j", (raw) => {
    expect(parseIp(raw)).toBeNull();
  });

  it("matches Cloudflare's ranges, IPv4 and IPv6, and nothing next to them", () => {
    expect(inRanges(CF_EDGE, CLOUDFLARE_RANGES)).toBe(true);
    expect(inRanges("104.16.0.1", CLOUDFLARE_RANGES)).toBe(true);
    expect(inRanges("2606:4700:10::ac43:1", CLOUDFLARE_RANGES)).toBe(true);
    expect(inRanges("2a06:98c7:ffff::1", CLOUDFLARE_RANGES)).toBe(true); // the /29
    expect(inRanges("172.63.255.255", CLOUDFLARE_RANGES)).toBe(false);
    expect(inRanges("172.72.0.0", CLOUDFLARE_RANGES)).toBe(false);
    expect(inRanges(VISITOR, CLOUDFLARE_RANGES)).toBe(false);
    expect(inRanges("2607:f8b0::1", CLOUDFLARE_RANGES)).toBe(false);
    expect(inRanges(null, CLOUDFLARE_RANGES)).toBe(false);
  });
});

describe("Cloud Run detection", () => {
  it("K_SERVICE (set by Cloud Run in every container) means Cloud Run", () => {
    vi.stubEnv("K_SERVICE", "bupulse");
    expect(currentPlatform()).toBe("cloudrun");
  });

  it("PLATFORM=cloudrun is accepted, and still wins over K_SERVICE when set to another host", () => {
    vi.stubEnv("PLATFORM", "CloudRun");
    expect(currentPlatform()).toBe("cloudrun");
    vi.stubEnv("PLATFORM", "node");
    vi.stubEnv("K_SERVICE", "bupulse");
    expect(currentPlatform()).toBe("node");
  });

  it("the Netlify global still wins over a stray K_SERVICE", () => {
    vi.stubEnv("K_SERVICE", "bupulse");
    vi.stubGlobal("Netlify", {});
    expect(currentPlatform()).toBe("netlify");
  });
});

describe("Cloud Run headers", () => {
  it("the peer is the last x-forwarded-for hop (Google appends it), after anything the caller sent", () => {
    expect(cloudRunPeer(h({ "x-forwarded-for": VISITOR }))).toBe(VISITOR);
    expect(cloudRunPeer(h({ "x-forwarded-for": `6.6.6.6, ${VISITOR}` }))).toBe(VISITOR);
    expect(cloudRunPeer(h({ "x-forwarded-for": `${VISITOR}, 35.191.3.4` }))).toBe(VISITOR); // a Google load balancer hop
    expect(cloudRunPeer(h({}))).toBeNull();
  });

  it("direct requests: the peer is the client, cf-* and x-nf-* headers a visitor sends are ignored, no country", () => {
    const forged = h({ "x-forwarded-for": `1.1.1.1, ${VISITOR}`, "cf-connecting-ip": "9.9.9.9", "cf-ipcountry": "RW", "x-nf-client-connection-ip": "8.8.8.8", "x-country": "RW" });
    expect(viaCloudflare(forged, "cloudrun")).toBe(false);
    expect(trustedClientIp(forged, "cloudrun")).toBe(VISITOR);
    expect(clientIp(forged, "cloudrun")).toBe(VISITOR);
    expect(visitorCountry(forged, "cloudrun")).toBeNull();
    expect(geoFrom(h({ "x-forwarded-for": VISITOR, "cf-ipcountry": "RW", "cf-ipcity": "Kigali" }), "cloudrun")).toEqual({ country: null, city: null, region: null, timezone: null });
  });

  it("a caller cannot pretend to be Cloudflare by putting a Cloudflare address earlier in x-forwarded-for", () => {
    const forged = h({ "x-forwarded-for": `${CF_EDGE}, ${VISITOR}`, "cf-connecting-ip": "9.9.9.9", "cf-ipcountry": "US" });
    expect(viaCloudflare(forged, "cloudrun")).toBe(false);
    expect(trustedClientIp(forged, "cloudrun")).toBe(VISITOR);
    expect(visitorCountry(forged, "cloudrun")).toBeNull();
  });

  it("through Cloudflare's proxy (the peer is a Cloudflare edge): Cloudflare's cf-* headers are trusted", () => {
    const proxied = h({ "x-forwarded-for": `6.6.6.6, ${VISITOR}, ${CF_EDGE}`, "cf-connecting-ip": VISITOR, "cf-ipcountry": "RW", "cf-ipcity": "Kigali", "cf-timezone": "Africa/Kigali" });
    expect(viaCloudflare(proxied, "cloudrun")).toBe(true);
    expect(trustedClientIp(proxied, "cloudrun")).toBe(VISITOR);
    expect(visitorCountry(proxied, "cloudrun")).toBe("RW");
    expect(geoFrom(proxied, "cloudrun")).toMatchObject({ country: "RW", city: "Kigali", timezone: "Africa/Kigali" });
  });

  it("through Cloudflare without cf-connecting-ip: no address (the shared bucket), never the edge's", () => {
    const proxied = h({ "x-forwarded-for": `${VISITOR}, ${CF_EDGE}` });
    expect(trustedClientIp(proxied, "cloudrun")).toBeNull();
    expect(clientIp(proxied, "cloudrun")).toBeNull();
  });

  it("the other hosts are unchanged", () => {
    const headers = h({ "x-forwarded-for": `${VISITOR}, ${CF_EDGE}`, "cf-connecting-ip": "9.9.9.9", "cf-ipcountry": "KE" });
    expect(viaCloudflare(headers, "cloudflare")).toBe(true);
    expect(viaCloudflare(headers, "node")).toBe(true);
    expect(viaCloudflare(headers, "netlify")).toBe(false);
    expect(trustedClientIp(headers, "cloudflare")).toBe("9.9.9.9");
    expect(visitorCountry(headers, "node")).toBe("KE");
  });
});

describe("Cloud Run runtime rules", () => {
  it("no waitUntil: keepAlive waits for the work in production (the CPU is throttled after the response)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(waitUntil(Promise.resolve(), "cloudrun")).toBe(false);
    let done = false;
    const work = new Promise<void>((resolve) => setTimeout(() => ((done = true), resolve()), 20));
    await keepAlive(work, "cloudrun");
    expect(done).toBe(true);
  });

  it("no request time limit, posts every minute, DATABASE_URL (no Hyperdrive)", () => {
    expect(hasShortRequestLimit("cloudrun")).toBe(false);
    expect(timeBudget(45_000, 15_000, "cloudrun")).toBe(45_000);
    expect(publishTimingNote("cloudrun")).toBeNull();
    expect(requestDatabase("cloudrun")).toBeUndefined();
  });

  it("Updates deploy through the Cloud Run workflow; DEPLOY_TARGET=cloudrun is accepted", () => {
    expect(deployHost({}, "cloudrun")).toBe("cloudrun");
    expect(deployHost({ DEPLOY_TARGET: "cloudrun" }, "node")).toBe("cloudrun");
    expect(deployHost({}, "node")).toBe("cloudflare");
    expect(DEPLOY_HOSTS.cloudrun.workflow).toBe("deploy-cloudrun.yml");
    expect(DEPLOY_HOSTS.cloudrun.runtime).toBe("Cloud Run service");
  });

  it("test-site-only features stay off on Cloud Run (bupulse.com)", () => {
    expect(labPresentersAllowed("cloudrun")).toBe(false);
    expect(subscriptionAllowed({ IMAGE_ENGINE_CLAUDE_SUBSCRIPTION: "1" }, "cloudrun")).toBe(false);
    expect(labPresentersAllowed("node")).toBe(true);
  });
});
