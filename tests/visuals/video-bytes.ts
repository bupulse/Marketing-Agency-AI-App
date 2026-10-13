// Tiny but real MP4 and WebM files for the duration parser and the upload checks.

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (type: string, body: number[]) => [...be32(8 + body.length), ...[...type].map((c) => c.charCodeAt(0)), ...body];

/** ftyp + moov/mvhd (version 0) with the given length in milliseconds (timescale 1000). */
export function mp4Bytes(durationMs: number): Uint8Array {
  const mvhd = box("mvhd", [0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(1000), ...be32(Math.round(durationMs)), ...new Array(80).fill(0)]);
  return new Uint8Array([...box("ftyp", [...[..."isom"].map((c) => c.charCodeAt(0)), 0, 0, 2, 0]), ...box("moov", mvhd)]);
}

const ebml = (id: number[], body: number[]) => [...id, 0x01, ...[0, 0, 0, 0, 0, 0, 0].map((_, i) => Math.floor(body.length / 256 ** (6 - i)) % 256), ...body];
const f64 = (n: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, n);
  return [...b];
};
const HEADER = ebml([0x1a, 0x45, 0xdf, 0xa3], ebml([0x42, 0x82], [..."webm"].map((c) => c.charCodeAt(0))));
const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

/** A WebM with Info/Duration (in ms, TimecodeScale 1 ms). */
export function webmBytes(durationMs: number): Uint8Array {
  const info = ebml([0x15, 0x49, 0xa9, 0x66], [...ebml([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]), ...ebml([0x44, 0x89], f64(durationMs))]);
  return new Uint8Array([...HEADER, 0x18, 0x53, 0x80, 0x67, ...UNKNOWN, ...info]);
}

/** A WebM as MediaRecorder writes it: no Duration, unknown-size Segment and Cluster; the last block at `lastMs`. */
export function liveWebmBytes(lastMs: number): Uint8Array {
  const block = (rel: number) => ebml([0xa3], [0x81, (rel >> 8) & 255, rel & 255, 0x80, 0, 0]);
  const clusterTc = Math.max(0, lastMs - 1000);
  const cluster = [0x1f, 0x43, 0xb6, 0x75, ...UNKNOWN, ...ebml([0xe7], be32(clusterTc)), ...block(0), ...block(lastMs - clusterTc)];
  return new Uint8Array([...HEADER, 0x18, 0x53, 0x80, 0x67, ...UNKNOWN, ...cluster]);
}
