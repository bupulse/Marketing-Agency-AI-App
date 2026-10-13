import { describe, expect, it } from "vitest";
import { runCost } from "@/lib/content-flow/cost";

describe("what a run uses (shown before confirming)", () => {
  it("one text generation per post and up to one AI image per designed post with AI designs", () => {
    const c = runCost({ mode: "ai", design: "ai", posts: 4, designed: 4, aiPhotos: true, textLeft: 26, imagesLeft: 12 });
    expect(c).toMatchObject({ text: 4, aiImages: 4, enoughText: true });
    expect(c.message).toBe("Uses 4 text generations and up to 4 AI images; you have 26 text generations and 12 AI images left this month.");
  });

  it("no AI images with free templates, without AI photos in the plan, or for bring-my-own", () => {
    expect(runCost({ mode: "ai", design: "free", posts: 3, designed: 3, aiPhotos: true, textLeft: 10, imagesLeft: 10 })).toMatchObject({ aiImages: 0, message: expect.stringContaining("no AI images") });
    expect(runCost({ mode: "describe", design: "ai", posts: 3, designed: 3, aiPhotos: false, textLeft: 10, imagesLeft: 10 }).aiImages).toBe(0);
    expect(runCost({ mode: "own", design: "ai", posts: 3, designed: 3, aiPhotos: true, textLeft: 10, imagesLeft: 10 }).aiImages).toBe(0);
  });

  it("caps AI images at the credits left and says when text generations are short", () => {
    expect(runCost({ mode: "ai", design: "ai", posts: 5, designed: 4, aiPhotos: true, textLeft: 10, imagesLeft: 2 }).aiImages).toBe(2);
    const short = runCost({ mode: "ai", design: "free", posts: 4, designed: 4, aiPhotos: false, textLeft: 2, imagesLeft: 0 });
    expect(short.enoughText).toBe(false);
    expect(short.message).toContain("Choose at most 2 apps.");
    expect(runCost({ mode: "ai", design: "free", posts: 0, designed: 0, aiPhotos: false, textLeft: 2, imagesLeft: 0 }).message).toContain("Choose at least one app.");
  });
});
