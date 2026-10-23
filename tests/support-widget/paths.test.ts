import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPathReporter, createThrottle, reportablePath, reportableReferrer } from "@/lib/support/client/paths";

describe("reported paths", () => {
  it("keeps only the path, never the query", () => {
    expect(reportablePath("/pricing/")).toBe("/pricing");
    expect(reportablePath("/reset-password?code=secret")).toBe("/reset-password");
    expect(reportablePath("/a#b")).toBe("/a");
    expect(reportablePath("")).toBe("/");
    expect(reportablePath("/")).toBe("/");
    expect(reportablePath(`/${"x".repeat(600)}`)).toHaveLength(500);
  });

  it("drops the referrer's query", () => {
    expect(reportableReferrer("https://www.google.com/search?q=private")).toBe("https://www.google.com/search");
    expect(reportableReferrer("")).toBeUndefined();
  });
});

describe("page changes", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reports the page the visitor settles on, once", () => {
    const seen: string[] = [];
    const r = createPathReporter((p) => seen.push(p), 1500);
    r.seed("/");
    r.push("/");
    vi.advanceTimersByTime(2000);
    expect(seen).toEqual([]); // the first page is already known from /visit
    r.push("/pricing");
    r.push("/signup");
    vi.advanceTimersByTime(1000);
    r.push("/pricing");
    vi.advanceTimersByTime(1500);
    expect(seen).toEqual(["/pricing"]);
    r.push("/pricing?plan=pro");
    vi.advanceTimersByTime(1500);
    expect(seen).toEqual(["/pricing"]);
    r.push("/creators");
    r.cancel();
    vi.advanceTimersByTime(5000);
    expect(seen).toEqual(["/pricing"]);
  });

  it("sends the typing draft at most once a second, the last one included", () => {
    let now = 0;
    const sent: string[] = [];
    const t = createThrottle<string>((v) => sent.push(v), 1000, () => now);
    t.call("h");
    t.call("he");
    t.call("hel");
    expect(sent).toEqual(["h"]);
    now = 1000;
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual(["h", "hel"]);
    now = 5000;
    t.call("hello");
    expect(sent).toEqual(["h", "hel", "hello"]);
  });
});
