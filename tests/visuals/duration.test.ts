import { describe, expect, it } from "vitest";
import { mp4DurationMs, videoDurationMs, webmDurationMs } from "@/lib/visuals/duration";
import { liveWebmBytes, mp4Bytes, webmBytes } from "./video-bytes";

describe("the real length of an uploaded video", () => {
  it("MP4: from moov/mvhd", () => {
    expect(mp4DurationMs(mp4Bytes(12_500))).toBe(12_500);
    expect(videoDurationMs(mp4Bytes(31_000), "video/mp4")).toBe(31_000);
  });

  it("WebM: from Info Duration, else the last block (MediaRecorder writes no Duration)", () => {
    expect(webmDurationMs(webmBytes(20_000))).toBe(20_000);
    expect(webmDurationMs(liveWebmBytes(15_000))).toBe(15_033);
  });

  it("garbage is not a length", () => {
    expect(videoDurationMs(new Uint8Array([1, 2, 3]), "video/mp4")).toBeNull();
    expect(videoDurationMs(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "video/webm")).toBeNull();
    expect(mp4DurationMs(new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});
