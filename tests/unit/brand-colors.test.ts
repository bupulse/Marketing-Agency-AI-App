import { describe, expect, it } from "vitest";
import { extractColors } from "@/lib/brand/colors";

/** RGBA pixels from [r, g, b, a, count] runs. */
function pixels(...runs: [number, number, number, number, number][]): Uint8ClampedArray {
  const out: number[] = [];
  for (const [r, g, b, a, n] of runs) for (let i = 0; i < n; i++) out.push(r, g, b, a);
  return new Uint8ClampedArray(out);
}

describe("extractColors", () => {
  it("returns the three main colours, most common first", () => {
    const data = pixels([255, 0, 0, 255, 50], [0, 0, 255, 255, 30], [0, 200, 0, 255, 10]);
    expect(extractColors(data)).toEqual(["#FF0000", "#0000FF", "#00C800"]);
  });

  it("ignores transparent, white and black pixels when there are other colours", () => {
    const data = pixels([0, 0, 0, 0, 500], [255, 255, 255, 255, 400], [10, 10, 10, 255, 300], [47, 107, 255, 255, 20]);
    expect(extractColors(data)).toEqual(["#2F6BFF"]);
  });

  it("merges near-identical shades into one colour", () => {
    const data = pixels([200, 30, 30, 255, 20], [204, 32, 28, 255, 20], [30, 30, 200, 255, 5]);
    expect(extractColors(data)).toHaveLength(2);
  });

  it("falls back to black and white for a plain black-and-white logo", () => {
    const data = pixels([255, 255, 255, 255, 40], [0, 0, 0, 255, 60]);
    expect(extractColors(data)).toEqual(["#000000", "#FFFFFF"]);
  });

  it("returns nothing for a fully transparent or empty image", () => {
    expect(extractColors(pixels([5, 5, 5, 0, 100]))).toEqual([]);
    expect(extractColors(new Uint8ClampedArray())).toEqual([]);
  });

  it("respects the max count", () => {
    const data = pixels([255, 0, 0, 255, 5], [0, 255, 0, 255, 4], [0, 0, 255, 255, 3]);
    expect(extractColors(data, 2)).toHaveLength(2);
  });
});
