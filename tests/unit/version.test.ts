import { describe, expect, it } from "vitest";
import { buildInfo, compareVersions, normalizeVersion, shortSha, updateState } from "@/lib/version";
import { notesToBlocks, plainText } from "@/lib/admin/release-notes";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("build info", () => {
  it("reads the inlined version and SHA, with local fallbacks", () => {
    expect(buildInfo("1.0.0", SHA)).toEqual({ version: "1.0.0", sha: SHA, short: "0123456" });
    expect(buildInfo(undefined, undefined)).toEqual({ version: "0.0.0", sha: "local", short: "local" });
    expect(buildInfo("v2.1.0", "")).toMatchObject({ version: "2.1.0", sha: "local" });
  });

  it("shortens only real SHAs", () => {
    expect(shortSha(SHA)).toBe("0123456");
    expect(shortSha("local")).toBe("local");
    expect(shortSha("v1.2.0")).toBe("v1.2.0");
  });
});

describe("versions", () => {
  it("normalises tags", () => {
    expect(normalizeVersion("v1.2.3")).toBe("1.2.3");
    expect(normalizeVersion("release-2.0.0-beta.1")).toBe("2.0.0-beta.1");
    expect(normalizeVersion("main")).toBe("");
  });

  it("compares numerically, with pre-releases before the release", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("2.0.0-beta.1", "2.0.0")).toBeLessThan(0);
    expect(compareVersions("2.0.0-beta.2", "2.0.0-beta.1")).toBeGreaterThan(0);
  });

  it("tells whether an update is available", () => {
    const current = buildInfo("1.0.0", SHA);
    expect(updateState(current, null)).toBe("unknown");
    expect(updateState(current, { version: "v1.1.0", sha: "f".repeat(40) })).toBe("update_available");
    expect(updateState(current, { version: "v0.9.0", sha: "f".repeat(40) })).toBe("ahead");
    expect(updateState(current, { version: "v1.0.0", sha: SHA })).toBe("up_to_date");
    // Same version number, different commit: the tag moved or main got a hotfix; say so.
    expect(updateState(current, { version: "v1.0.0", sha: "f".repeat(40) })).toBe("update_available");
    // A local build cannot compare SHAs; same number means up to date.
    expect(updateState(buildInfo("1.0.0", undefined), { version: "v1.0.0", sha: "f".repeat(40) })).toBe("up_to_date");
    // A bare commit with no version: only the SHA can be compared.
    expect(updateState(current, { version: null, sha: SHA })).toBe("up_to_date");
    expect(updateState(current, { version: null, sha: "f".repeat(40) })).toBe("unknown");
  });
});

describe("release notes", () => {
  it("turns markdown into headings, paragraphs and lists without any HTML", () => {
    const md = "## What's new\n\nFaster **publishing** and a [fix](https://example.com) for `jpeg`.\n\n- Item one\n* Item *two*\n1. Third\n\n<img src=x onerror=alert(1)>Plain <b>text</b>\n\n```\ncode line\n```\n---\n> quoted";
    expect(notesToBlocks(md)).toEqual([
      { type: "heading", text: "What's new" },
      { type: "paragraph", text: "Faster publishing and a fix for jpeg." },
      { type: "list", items: ["Item one", "Item two", "Third"] },
      { type: "paragraph", text: "Plain text" },
      { type: "paragraph", text: "code line" },
      { type: "paragraph", text: "quoted" },
    ]);
    expect(JSON.stringify(notesToBlocks(md))).not.toContain("<");
  });

  it("handles empty notes and Windows line endings", () => {
    expect(notesToBlocks(null)).toEqual([]);
    expect(notesToBlocks("")).toEqual([]);
    expect(notesToBlocks("a\r\n\r\nb")).toEqual([{ type: "paragraph", text: "a" }, { type: "paragraph", text: "b" }]);
  });

  it("strips inline markup", () => {
    expect(plainText("![logo](x.png) __bold__ _it_ `code` [link](http://x)")).toBe("logo bold it code link");
  });
});
