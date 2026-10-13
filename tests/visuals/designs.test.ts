import { describe, expect, it } from "vitest";
import { getDesign } from "@/lib/designs/library/catalog";
import { isVideoLookId } from "@/lib/visuals/video-looks";
import { assignDesigns, chooseLook, recentChoices, slideAngle, slideHasPhoto, usableDesign } from "@/lib/visuals/designs";
import type { ImagePlan, VisualSlide } from "@/lib/visuals/types";

const slide = (over: Partial<VisualSlide> = {}): VisualSlide => ({ template: "new-arrival", headline: "Fresh sourdough", subline: "", chip: "", source: "album", photoPath: "u/projects/p/a.jpg", designId: null, path: null, ...over });
const plan = (slides: VisualSlide[], pack: ImagePlan["pack"] = "warm"): ImagePlan => ({ version: 1, pack, aspectRatio: "4:5", slides, directedBy: "rules", notes: [] });

describe("slide designs", () => {
  it("reads the slide's angle from its template, chip and place", () => {
    expect(slideAngle(slide({ template: "offer", chip: "20% off" }), 0, 1)).toBe("price");
    expect(slideAngle(slide({ template: "offer", chip: "Book now" }), 0, 1)).toBe("offer");
    expect(slideAngle(slide({ template: "announcement", source: "text", photoPath: null }), 2, 4)).toBe("tips");
    expect(slideAngle(slide({ template: "announcement", source: "text", photoPath: null }), 0, 1)).toBe("announcement");
    expect(slideAngle(slide({ template: "quote" }), 0, 1)).toBe("quote");
  });

  it("knows when a slide has a photo", () => {
    expect(slideHasPhoto(slide())).toBe(true);
    expect(slideHasPhoto(slide({ source: "text", photoPath: null }))).toBe(false);
    expect(slideHasPhoto(slide({ source: "ai", photoPath: null }))).toBe(true);
  });

  it("gives every slide a design of the plan's style, different from each other and from recent ones, numbering tips", () => {
    const tips = [1, 2, 3].map((n) => slide({ template: "announcement", source: "text", photoPath: null, headline: `Tip ${n}` }));
    const recent = ["warm/hero-01", "warm/split-02"];
    const out = assignDesigns(plan([slide(), ...tips]), { recent, seed: "content-1" });
    const ids = out.slides.map((s) => s.design!);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) {
      expect(getDesign(id)?.style).toBe("warm");
      expect(recent).not.toContain(id);
    }
    expect(getDesign(ids[1])?.needsPhoto).toBe(false);
    expect(out.slides.slice(1).map((s) => s.step)).toEqual([1, 2, 3]);
    expect(assignDesigns(plan([slide(), ...tips]), { recent, seed: "content-1" }).slides.map((s) => s.design)).toEqual(ids);
  });

  it("redesigns only the asked slides", () => {
    const first = assignDesigns(plan([slide(), slide({ headline: "Two" })]), { recent: [], seed: "a" });
    const again = assignDesigns(first, { recent: [], seed: "b", only: new Set([1]) });
    expect(again.slides[0].design).toBe(first.slides[0].design);
    expect(again.slides[1].design).not.toBe(again.slides[0].design);
  });

  it("drops a design of another style or one that needs a missing photo", () => {
    expect(usableDesign({ design: "warm/split-01" }, "warm", true)).toBe("warm/split-01");
    expect(usableDesign({ design: "warm/split-01" }, "bold", true)).toBeNull();
    expect(usableDesign({ design: "warm/hero-01" }, "warm", false)).toBeNull();
    expect(usableDesign({}, "warm", true)).toBeNull();
  });

  it("collects recent designs and looks from stored plans, ignoring junk", () => {
    expect(recentChoices([{ slides: [{ design: "warm/hero-01" }, { template: "offer" }] }, { look: "warm/v-02", scenes: [] }, null, "x", { slides: "no" }])).toEqual({ designs: ["warm/hero-01"], looks: ["warm/v-02"] });
  });

  it("chooses a video look of the style that avoids recent looks", () => {
    const first = chooseLook({ pack: "retro", template: "offer", hasPhoto: true, recent: [], seed: "v" });
    expect(isVideoLookId(first)).toBe(true);
    expect(first.startsWith("retro/")).toBe(true);
    expect(chooseLook({ pack: "retro", template: "offer", hasPhoto: true, recent: [first], seed: "v" })).not.toBe(first);
  });
});
