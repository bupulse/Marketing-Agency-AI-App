import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Gallery } from "@/app/admin/(console)/(ai)/training-lab/gallery";
import { KIND_CHIPS, chipHref, exampleIdFromHash, galleryItem, libraryHref, thumbOf } from "@/lib/training-lab/gallery";

const ex = (over: Record<string, unknown> = {}) => ({ id: "e1", title: "Kigali car seller", kind: "reel", rating: 4 as number | null, neverThis: null as string | null, path: "u/e1/a.mp4" as string | null, mime: "video/mp4" as string | null, sourceUrl: null as string | null, ...over });

describe("thumbOf", () => {
  it("shows the video's first frame, the image, or an icon", () => {
    expect(thumbOf(ex(), "https://s/v")).toEqual({ type: "video", url: "https://s/v" });
    expect(thumbOf(ex({ mime: "image/jpeg" }), "https://s/i")).toEqual({ type: "image", url: "https://s/i" });
    expect(thumbOf(ex({ kind: "voice", mime: "audio/mpeg" }), "https://s/a")).toEqual({ type: "audio" });
    expect(thumbOf(ex({ mime: "application/pdf" }), "https://s/x")).toEqual({ type: "file" });
  });
  it("is a calendar for a posting habit and a link icon for a link", () => {
    expect(thumbOf(ex({ kind: "schedule", path: null, mime: null }))).toEqual({ type: "habit" });
    expect(thumbOf(ex({ path: null, mime: null, sourceUrl: "https://tiktok.com/x" }))).toEqual({ type: "link" });
  });
  it("says missing when the file cannot be shown, or there is nothing", () => {
    expect(thumbOf(ex(), undefined)).toEqual({ type: "missing" });
    expect(thumbOf(ex({ path: null, mime: null }))).toEqual({ type: "missing" });
  });
});

describe("galleryItem", () => {
  it("carries what a card shows", () => {
    expect(galleryItem(ex({ neverThis: " no stock music " }), { link: "https://s/v", times: 7, warning: "Say what to avoid." })).toEqual({
      id: "e1", title: "Kigali car seller", kind: "reel", kindLabel: "Reel", rating: 4, never: true, used: 7, warning: "Say what to avoid.", thumb: { type: "video", url: "https://s/v" },
    });
  });
  it("has no badge, count or warning when there is nothing to say", () => {
    const item = galleryItem(ex({ neverThis: "  ", rating: null }), { link: "https://s/v", times: 0 });
    expect(item).toMatchObject({ never: false, used: null, warning: null, rating: null });
  });
});

describe("kind chips and links", () => {
  it("are All and one per kind, in the owner's words", () => {
    expect(KIND_CHIPS.map((c) => c.label)).toEqual(["All", "Reels", "Videos", "Images", "Recordings", "Actors", "Habits"]);
    expect(KIND_CHIPS.map((c) => c.kind)).toEqual([null, "reel", "video", "image", "voice", "actor", "schedule"]);
  });
  it("keep the other filters and set or clear the kind", () => {
    const base = "/admin/training-lab";
    expect(chipHref(base, { sector: "farming", engine: "reel" }, "voice")).toBe("/admin/training-lab?kind=voice&sector=farming&engine=reel");
    expect(chipHref(base, { kind: "reel", language: "Kinyarwanda" }, null)).toBe("/admin/training-lab?language=Kinyarwanda");
    expect(chipHref(base, { kind: "reel" }, null)).toBe(base);
    expect(libraryHref(base, { kind: "", sector: "a b" })).toBe("/admin/training-lab?sector=a+b");
  });
});

describe("anchors", () => {
  it("find the example an anchor points at", () => {
    expect(exampleIdFromHash("#ex-cmh4abc")).toBe("cmh4abc");
    expect(exampleIdFromHash("ex-a_b-1")).toBe("a_b-1");
    for (const bad of ["", "#", "#finished-reels", "#ex-", "#ex-a/b", "#ex-a b"]) expect(exampleIdFromHash(bad)).toBeNull();
  });
});

describe("the gallery", () => {
  const items = [
    galleryItem(ex({ neverThis: "stock smiles" }), { link: "https://s/v", times: 3, warning: "No engine reads it." }),
    galleryItem(ex({ id: "e2", title: "Greeting", kind: "voice", mime: "audio/mpeg", rating: null }), { link: "https://s/a" }),
    galleryItem(ex({ id: "e3", title: "Facebook in Kigali", kind: "schedule", path: null, mime: null, rating: 5 })),
  ];
  const html = renderToStaticMarkup(createElement(Gallery, { items, details: {}, empty: "Your Lab is empty." }));
  it("shows a card per example with its title, kind, stars, Never badge, usage and warning", () => {
    expect(html.match(/id="ex-e\d"/g)).toHaveLength(3);
    for (const text of ["Kigali car seller", "Greeting", "Facebook in Kigali", ">Reel<", ">Kinyarwanda recording<", "Never", "Used 3×", "No engine reads it.", "4 of 5 stars", "Not rated", "5 of 5 stars"]) expect(html).toContain(text);
  });
  it("shows the video's first frame muted, and no detail until a card is opened", () => {
    expect(html).toContain('src="https://s/v#t=0.1"');
    expect(html).toMatch(/<video[^>]*muted/);
    expect(html).not.toContain('role="dialog"');
  });
  it("says so, in friendly words, when the Lab is empty", () => {
    expect(renderToStaticMarkup(createElement(Gallery, { items: [], details: {}, empty: "Your Lab is empty. Drop your best reel above to start." }))).toContain("Your Lab is empty. Drop your best reel above to start.");
  });
});
