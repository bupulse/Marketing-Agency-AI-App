import { describe, expect, it } from "vitest";
import {
  MAX_FEATURES,
  PROJECT_TYPES,
  addFeature,
  addHashtag,
  aspectNote,
  detailsText,
  formatCopyText,
  getProjectType,
  normalizeHashtag,
  parseVariants,
  photoProblem,
  postLength,
  typeLabel,
  usageNote,
} from "@/components/studio/helpers";

describe("project types", () => {
  it("covers any kind of business and falls back to Other", () => {
    expect(PROJECT_TYPES.map((t) => t.value)).toEqual(["product", "service", "event", "offer", "listing", "project", "other"]);
    expect(getProjectType("event").detailsPlaceholder).toMatch(/date/i);
    expect(getProjectType("zzz").value).toBe("other");
    expect(typeLabel("offer")).toBe("Offer");
    expect(typeLabel("custom")).toBe("Custom");
  });
});

describe("features", () => {
  it("trims, de-duplicates and caps at 10", () => {
    expect(addFeature([], "  Free   delivery ")).toEqual(["Free delivery"]);
    expect(addFeature(["Free delivery"], "free DELIVERY")).toEqual(["Free delivery"]);
    expect(addFeature([], "   ")).toEqual([]);
    const full = Array.from({ length: MAX_FEATURES }, (_, i) => `f${i}`);
    expect(addFeature(full, "one more")).toBe(full);
  });
});

describe("hashtags and copy text", () => {
  it("normalises hashtags", () => {
    expect(normalizeHashtag("summer sale!")).toBe("#summersale");
    expect(normalizeHashtag("#Café")).toBe("#Café");
    expect(normalizeHashtag("###")).toBe("");
    expect(addHashtag(["#a"], "A")).toEqual(["#a"]);
    expect(addHashtag(["#a"], "b")).toEqual(["#a", "#b"]);
  });

  it("copies caption and hashtags together", () => {
    expect(formatCopyText(" Hello ", ["sale", "#new"])).toBe("Hello\n\n#sale #new");
    expect(formatCopyText("Hello", [])).toBe("Hello");
  });

  it("counts the whole post", () => {
    expect(postLength("Hi", ["a"])).toBe("Hi\n\n#a".length);
  });
});

describe("network variants", () => {
  it("keeps valid variants and drops the rest", () => {
    const parsed = parseVariants([
      { network: "x", caption: "Short", hashtags: ["#a", 3], aspectRatio: "16:9", characterCount: 12, limit: 280 },
      { network: "myspace", caption: "no" },
      "nope",
      { network: "tiktok", caption: "Hi" },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ network: "x", hashtags: ["#a"], limit: 280 });
    expect(parsed[1]).toMatchObject({ network: "tiktok", aspectRatio: "1:1", limit: 0 });
    expect(parseVariants(null)).toEqual([]);
  });

  it("describes aspect ratios", () => {
    expect(aspectNote("9:16")).toContain("vertical");
    expect(aspectNote("3:2")).toBe("3:2");
  });
});

describe("misc", () => {
  it("writes the usage note", () => {
    expect(usageNote()).toBe("Uses 1 text generation.");
    expect(usageNote(12, 50)).toContain("12 of 50");
  });

  it("reads details as text only", () => {
    expect(detailsText("Open Sunday")).toBe("Open Sunday");
    expect(detailsText({ a: 1 })).toBe("");
  });

  it("checks photo files", () => {
    expect(photoProblem({ type: "image/png", size: 1000 })).toBeNull();
    expect(photoProblem({ type: "image/gif", size: 1000 })).toMatch(/JPG/);
    expect(photoProblem({ type: "image/jpeg", size: 11 * 1024 * 1024 })).toMatch(/10 MB/);
  });
});
