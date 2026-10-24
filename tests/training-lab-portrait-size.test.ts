import { describe, expect, it } from "vitest";
import { PORTRAIT_MAX_SIDE, momentOf, portraitSize } from "@/lib/training-lab/portrait";

describe("portrait size", () => {
  it("keeps a small video's size and scales a big one to 1600 px on the longest side", () => {
    expect(portraitSize(720, 1280)).toEqual({ width: 720, height: 1280 });
    expect(portraitSize(3840, 2160)).toEqual({ width: 1600, height: 900 });
    expect(portraitSize(2160, 3840)).toEqual({ width: 900, height: 1600 });
    expect(PORTRAIT_MAX_SIDE).toBe(1600);
  });
  it("gives nothing before the video has loaded", () => {
    expect(portraitSize(0, 0)).toBeNull();
    expect(portraitSize(Number.NaN, 100)).toBeNull();
  });
  it("rounds the moment to a tenth of a second", () => {
    expect(momentOf(12.34)).toBe(12.3);
    expect(momentOf(-2)).toBe(0);
    expect(momentOf(Number.NaN)).toBe(0);
  });
});
