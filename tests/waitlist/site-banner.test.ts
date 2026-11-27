import { describe, expect, it } from "vitest";
import { bannerFromForm, bannerPaint, bannerShowing, BannerError, cleanSiteBanner, DEFAULT_BANNER, isoToKigaliLocal, kigaliLocalToIso, readSiteBanner, textOn } from "@/lib/site-banner";

const ok = (over: Record<string, unknown> = {}) => cleanSiteBanner({ ...DEFAULT_BANNER, ...over });

describe("site banner settings", () => {
  it("keeps a good banner as it is", () => {
    expect(ok()).toEqual(DEFAULT_BANNER);
  });

  it("refuses an empty message, a too-long one, and unknown choices", () => {
    expect(() => ok({ text: "  " })).toThrow(BannerError);
    expect(() => ok({ text: "x".repeat(161) })).toThrow(/under 160/);
    expect(() => ok({ font: "comic" })).toThrow(/font/);
    expect(() => ok({ color: "pink" })).toThrow(/colour/);
  });

  it("needs a real colour for 'your own' and a link for a link button", () => {
    expect(() => ok({ color: "custom", customColor: "red" })).toThrow(/own colour/);
    expect(ok({ color: "custom", customColor: "#00AA55" }).customColor).toBe("#00aa55");
    expect(() => ok({ button: "link", buttonUrl: "" })).toThrow(/link/);
    expect(() => ok({ button: "link", buttonUrl: "javascript:alert(1)" })).toThrow(/https/);
    expect(() => ok({ button: "link", buttonUrl: "//evil.example" })).toThrow(/https/);
    expect(ok({ button: "link", buttonUrl: "/pricing" }).buttonUrl).toBe("/pricing");
    expect(ok({ button: "link", buttonUrl: "https://bupulse.com/quote" }).buttonUrl).toBe("https://bupulse.com/quote");
  });

  it("needs 'hide after' later than 'show from'", () => {
    expect(() => ok({ showFrom: "2026-12-10T00:00:00Z", hideAfter: "2026-12-09T00:00:00Z" })).toThrow(/later/);
  });

  it("falls back to the default for nothing or something unreadable stored", () => {
    expect(readSiteBanner(undefined)).toEqual(DEFAULT_BANNER);
    expect(readSiteBanner({ text: "" })).toEqual(DEFAULT_BANNER);
  });

  it("treats banners saved before the button-colour switch as on", () => {
    const older: Partial<typeof DEFAULT_BANNER> = { ...DEFAULT_BANNER };
    delete older.matchButton;
    expect(cleanSiteBanner(older).matchButton).toBe(true);
  });
});

describe("when the banner shows", () => {
  const at = (iso: string) => new Date(iso).getTime();

  it("only while switched on and inside its dates", () => {
    const b = ok({ on: true, showFrom: "2026-12-01T00:00:00Z", hideAfter: "2026-12-20T00:00:00Z", whenEnded: "keep" });
    expect(bannerShowing({ ...b, on: false }, at("2026-12-05T00:00:00Z"))).toBe(false);
    expect(bannerShowing(b, at("2026-11-30T23:59:00Z"))).toBe(false);
    expect(bannerShowing(b, at("2026-12-05T00:00:00Z"))).toBe(true);
    expect(bannerShowing(b, at("2026-12-20T00:00:00Z"))).toBe(false);
  });

  it("disappears when its countdown ends if set to hide", () => {
    const b = ok({ on: true, whenEnded: "hide" });
    expect(bannerShowing(b, at("2026-12-14T21:59:00Z"))).toBe(true);
    expect(bannerShowing(b, at("2026-12-14T22:00:00Z"))).toBe(false);
    expect(bannerShowing({ ...b, whenEnded: "text" }, at("2026-12-15T10:00:00Z"))).toBe(true);
  });
});

describe("the Admin form", () => {
  it("reads Kigali times and the countdown switch", () => {
    const fields: Record<string, string> = { on: "on", text: "Hello", color: "red", font: "bold", animation: "shimmer", decor: "christmas", countdownOn: "on", countdownAt: "2026-12-15T00:00", whenEnded: "text", endedText: "Live!", button: "quote", buttonLabel: "Go", headerButton: "pulse", matchButton: "on", showFrom: "", hideAfter: "2026-12-31T18:30" };
    const raw = bannerFromForm((k) => fields[k] ?? null);
    const b = cleanSiteBanner(raw);
    expect(b.countdownAt).toBe("2026-12-14T22:00:00.000Z");
    expect(b.hideAfter).toBe("2026-12-31T16:30:00.000Z");
    expect(b.showFrom).toBeNull();
    expect(b).toMatchObject({ on: true, font: "bold", animation: "shimmer", headerButton: "pulse", matchButton: true });
    expect(cleanSiteBanner(bannerFromForm((k) => (k === "countdownOn" ? null : (fields[k] ?? null)))).countdownAt).toBeNull();
  });

  it("converts Kigali time both ways and flags a bad date", () => {
    expect(kigaliLocalToIso("2026-12-15T00:00")).toBe("2026-12-14T22:00:00.000Z");
    expect(isoToKigaliLocal("2026-12-14T22:00:00.000Z")).toBe("2026-12-15T00:00");
    expect(kigaliLocalToIso("")).toBeNull();
    expect(kigaliLocalToIso("2026-02-30T10:00")).toBe("invalid");
  });
});

describe("colours", () => {
  it("picks readable text on a custom colour", () => {
    expect(textOn("#ffffff")).toBe("dark");
    expect(textOn("#f5b70a")).toBe("dark");
    expect(textOn("#0b0b0f")).toBe("light");
    expect(textOn("#d91f26")).toBe("light");
  });

  it("gives the main button the banner's colours", () => {
    expect(bannerPaint({ color: "red", customColor: "#000000" })).toEqual({ bg: "#d91f26", fg: "#ffffff" });
    expect(bannerPaint({ color: "orange", customColor: "#000000" }).fg).toBe("#1a1006");
    expect(bannerPaint({ color: "custom", customColor: "#ffee00" })).toEqual({ bg: "#ffee00", fg: "#111111" });
    expect(bannerPaint({ color: "gold-metal", customColor: "#000000" }).bg).toContain("linear-gradient");
    expect(bannerPaint({ color: "black-gold", customColor: "#000000" }).fg).toBe("#f3d36b");
  });
});
