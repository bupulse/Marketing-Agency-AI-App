import { describe, expect, it } from "vitest";
import { buildPlatforms, escapeAttr, scriptTag, PASTE_WARNING } from "@/lib/widget/install";
import { describeSeen, formatAgo, shouldRecordSeen, SEEN_THROTTLE_MS, widgetInstalled } from "@/lib/widget/seen";

const base = "https://bupulse.com";
const key = "widgetkey12345";
const platforms = buildPlatforms({ baseUrl: `${base}/`, key });

describe("install snippets", () => {
  it("has every platform the owner asked for", () => {
    expect(platforms.map((p) => p.id)).toEqual(["html", "wordpress", "nextjs", "react", "shopify", "wix", "squarespace", "webflow", "gtm"]);
  });

  it("puts the real key and base URL (no double slash) in every code block", () => {
    for (const p of platforms) {
      expect(p.variants.length).toBeGreaterThan(0);
      for (const v of p.variants) {
        expect(v.code, `${p.id}/${v.id}`).toContain(`${base}/widget.js`);
        expect(v.code, `${p.id}/${v.id}`).toContain(key);
        expect(v.code).not.toContain("//widget.js");
      }
    }
  });

  it("gives 3 to 6 steps per variant, ending with the finished site", () => {
    for (const p of platforms) {
      for (const v of p.variants) {
        expect(v.steps.length, `${p.id}/${v.id}`).toBeGreaterThanOrEqual(3);
        expect(v.steps.length).toBeLessThanOrEqual(6);
        expect(v.steps.at(-1)?.scene.type).toBe("site");
        for (const s of v.steps) expect(s.title && s.text).toBeTruthy();
      }
    }
  });

  it("Next.js has App Router and Pages Router with next/script afterInteractive", () => {
    const next = platforms.find((p) => p.id === "nextjs")!;
    expect(next.variants.map((v) => v.id)).toEqual(["app", "pages"]);
    const app = next.variants[0];
    expect(app.code).toContain('import Script from "next/script"');
    expect(app.code).toContain('strategy="afterInteractive"');
    expect(app.code).toMatch(/<body>[\s\S]*<Script[\s\S]*<\/body>/);
    expect(next.variants[1].code).toContain("AppProps");
  });

  it("WordPress offers the plugin and footer.php; React offers index.html and a component", () => {
    expect(platforms.find((p) => p.id === "wordpress")!.variants.map((v) => v.id)).toEqual(["plugin", "footer"]);
    const react = platforms.find((p) => p.id === "react")!;
    expect(react.variants.map((v) => v.id)).toEqual(["index", "component"]);
    expect(react.variants[1].code).toContain("useEffect");
  });

  it("escapes a hostile key and base so they cannot break out of the markup", () => {
    const evil = buildPlatforms({ baseUrl: 'https://x.com/"><script>alert(1)</script>', key: 'k"><img src=x onerror=alert(1)>' });
    for (const p of evil) {
      for (const v of p.variants) {
        expect(v.code).not.toContain('"><script>');
        expect(v.code).not.toContain('"><img');
        expect(v.code).not.toContain("</script><");
      }
    }
    expect(escapeAttr('a"b<c>&')).toBe("a&quot;b&lt;c&gt;&amp;");
    expect(scriptTag(base, key)).toBe(`<script src="${base}/widget.js" data-key="${key}" async></script>`);
  });

  it("warns not to save the code as a file", () => {
    expect(PASTE_WARNING).toMatch(/exactly as shown/);
    expect(PASTE_WARNING).toMatch(/file/);
  });
});

describe("installation check", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  it("records only real sites, at most every 10 minutes", () => {
    const own = ["bupulse.com"];
    expect(shouldRecordSeen({ host: "shop.com", ownHosts: own, lastSeenAt: null, now })).toBe(true);
    expect(shouldRecordSeen({ host: "bupulse.com", ownHosts: own, lastSeenAt: null, now })).toBe(false);
    expect(shouldRecordSeen({ host: "local-file", ownHosts: own, lastSeenAt: null, now })).toBe(false);
    expect(shouldRecordSeen({ host: null, ownHosts: own, lastSeenAt: null, now })).toBe(false);
    expect(shouldRecordSeen({ host: "shop.com", ownHosts: own, lastSeenAt: new Date(now.getTime() - SEEN_THROTTLE_MS + 1000), now })).toBe(false);
    expect(shouldRecordSeen({ host: "shop.com", ownHosts: own, lastSeenAt: new Date(now.getTime() - SEEN_THROTTLE_MS), now })).toBe(true);
  });
  it("says never, seen, mismatch and stale", () => {
    expect(describeSeen({ lastSeenAt: null, lastSeenHost: null, now })).toEqual({ status: "never" });
    const two = new Date(now.getTime() - 2 * 60000);
    expect(describeSeen({ lastSeenAt: two, lastSeenHost: "wecall.rw", now })).toEqual({ status: "seen", host: "wecall.rw", ago: "2 minutes ago", matches: null, recent: true });
    expect(describeSeen({ lastSeenAt: two, lastSeenHost: "wecall.rw", url: "https://www.wecall.rw/contact", now })).toMatchObject({ matches: true });
    expect(describeSeen({ lastSeenAt: two, lastSeenHost: "wecall.rw", url: "https://other.com", now })).toMatchObject({ matches: false });
    expect(describeSeen({ lastSeenAt: new Date(now.getTime() - 3 * 86400000), lastSeenHost: "a.com", now })).toMatchObject({ recent: false, ago: "3 days ago" });
  });
  it("formats ages", () => {
    expect(formatAgo(10_000)).toBe("just now");
    expect(formatAgo(60_000)).toBe("1 minute ago");
    expect(formatAgo(3 * 3600_000)).toBe("3 hours ago");
  });
});

describe("dashboard checklist: widget installed", () => {
  const seen = { lastSeenAt: new Date("2026-10-14T08:00:00Z"), lastSeenHost: "www.shop.rw", allowedDomains: ["shop.rw"] };
  it("is done once the widget loaded on an allowed site", () => {
    expect(widgetInstalled({ widget: seen, cloudflareInstalls: 0 })).toBe(true);
    expect(widgetInstalled({ widget: { ...seen, lastSeenHost: "blog.shop.rw" }, cloudflareInstalls: 0 })).toBe(true);
    // Any site is allowed until the list is set.
    expect(widgetInstalled({ widget: { ...seen, allowedDomains: [] }, cloudflareInstalls: 0 })).toBe(true);
  });
  it("is not done before it loaded anywhere, or when that site is no longer allowed", () => {
    expect(widgetInstalled({ widget: null, cloudflareInstalls: 0 })).toBe(false);
    expect(widgetInstalled({ widget: { ...seen, lastSeenAt: null, lastSeenHost: null }, cloudflareInstalls: 0 })).toBe(false);
    expect(widgetInstalled({ widget: { ...seen, allowedDomains: ["other.rw"] }, cloudflareInstalls: 0 })).toBe(false);
  });
  it("is done when BuPulse added it to a site through Cloudflare", () => {
    expect(widgetInstalled({ widget: null, cloudflareInstalls: 1 })).toBe(true);
  });
});
