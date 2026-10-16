// The real length of an uploaded video, read from the file itself (the browser's word is not billed): an MP4's movie
// header (mvhd), or a WebM's Segment Info Duration, else its last block's timecode (MediaRecorder writes no Duration).
// Pure, so it is unit tested. Null when the file cannot be read.

function u32(b: Uint8Array, i: number) {
  return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
}

/** Milliseconds from an MP4's moov/mvhd box. */
export function mp4DurationMs(bytes: Uint8Array): number | null {
  const find = (start: number, end: number, type: string): [number, number] | null => {
    let i = start;
    while (i + 8 <= end) {
      let size = u32(bytes, i);
      let header = 8;
      if (size === 1) {
        if (i + 16 > end) return null;
        size = u32(bytes, i + 8) * 2 ** 32 + u32(bytes, i + 12);
        header = 16;
      } else if (size === 0) size = end - i;
      if (size < header) return null;
      if (String.fromCharCode(...bytes.subarray(i + 4, i + 8)) === type) return [i + header, Math.min(end, i + size)];
      i += size;
    }
    return null;
  };
  const moov = find(0, bytes.length, "moov");
  const mvhd = moov && find(moov[0], moov[1], "mvhd");
  if (!mvhd) return null;
  const [p, end] = mvhd;
  const version = bytes[p];
  if (version === 1) {
    if (p + 32 > end) return null;
    const timescale = u32(bytes, p + 20);
    const duration = u32(bytes, p + 24) * 2 ** 32 + u32(bytes, p + 28);
    return timescale > 0 ? (duration / timescale) * 1000 : null;
  }
  if (p + 20 > end) return null;
  const timescale = u32(bytes, p + 12);
  const duration = u32(bytes, p + 16);
  return timescale > 0 ? (duration / timescale) * 1000 : null;
}

/** An EBML variable-length integer at `i`: its value and length; `unknown` when every value bit is 1 (unknown size). */
function vint(b: Uint8Array, i: number, keepMarker = false): { value: number; length: number; unknown: boolean } | null {
  const first = b[i];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || i + length > b.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let k = 1; k < length; k++) {
    value = value * 256 + b[i + k];
    if (b[i + k] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const CLUSTER = 0x1f43b675;
const BLOCK_GROUP = 0xa0;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const CLUSTER_TIMECODE = 0xe7;
const SIMPLE_BLOCK = 0xa3;
const BLOCK = 0xa1;
/** Elements entered instead of skipped: their children are read in the same flat scan. */
const CONTAINERS = new Set([SEGMENT, INFO, CLUSTER, BLOCK_GROUP]);

function uint(b: Uint8Array, i: number, n: number) {
  let v = 0;
  for (let k = 0; k < n; k++) v = v * 256 + b[i + k];
  return v;
}

/** Milliseconds from a WebM: the Info Duration, else the latest block timecode plus one frame (about 33 ms). */
export function webmDurationMs(bytes: Uint8Array, options: { infoOnly?: boolean } = {}): number | null {
  let scale = 1_000_000;
  let duration: number | null = null;
  let cluster = 0;
  let last = -1;
  let i = 0;
  // Skip the EBML header.
  const id0 = vint(bytes, 0, true);
  const size0 = id0 && vint(bytes, id0.length);
  if (!id0 || !size0 || id0.value !== 0x1a45dfa3) return null;
  i = id0.length + size0.length + size0.value;
  while (i < bytes.length) {
    const id = vint(bytes, i, true);
    const size = id && vint(bytes, i + id.length);
    if (!id || !size) break;
    const data = i + id.length + size.length;
    if (CONTAINERS.has(id.value)) {
      i = data;
      continue;
    }
    if (size.unknown || data + size.value > bytes.length) break;
    if (id.value === TIMECODE_SCALE) scale = uint(bytes, data, size.value) || scale;
    else if (id.value === DURATION) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + data, size.value);
      duration = size.value === 4 ? view.getFloat32(0) : size.value === 8 ? view.getFloat64(0) : null;
    } else if (id.value === CLUSTER_TIMECODE) cluster = uint(bytes, data, size.value);
    else if (id.value === SIMPLE_BLOCK || id.value === BLOCK) {
      const track = vint(bytes, data);
      if (track) {
        const raw = (bytes[data + track.length] << 8) | bytes[data + track.length + 1];
        last = Math.max(last, cluster + (raw > 0x7fff ? raw - 0x10000 : raw));
      }
    }
    i = data + size.value;
  }
  if (duration !== null && Number.isFinite(duration) && duration > 0) return (duration * scale) / 1_000_000;
  if (options.infoOnly) return null;
  return last >= 0 ? (last * scale) / 1_000_000 + 33 : null;
}

/** Only a WebM's Info Duration (for a file read in part: the last block seen is not the end of the video). */
export function webmInfoDurationMs(bytes: Uint8Array): number | null {
  return webmDurationMs(bytes, { infoOnly: true });
}

export function videoDurationMs(bytes: Uint8Array, type: "video/mp4" | "video/webm"): number | null {
  try {
    return type === "video/mp4" ? mp4DurationMs(bytes) : webmDurationMs(bytes);
  } catch {
    return null;
  }
}

/** Boxes inside [start, end): each one's type and body range. */
function boxes(bytes: Uint8Array, start: number, end: number): { type: string; body: number; end: number }[] {
  const out: { type: string; body: number; end: number }[] = [];
  let i = start;
  while (i + 8 <= end && out.length < 256) {
    let size = u32(bytes, i);
    let header = 8;
    if (size === 1) {
      if (i + 16 > end) break;
      size = u32(bytes, i + 8) * 2 ** 32 + u32(bytes, i + 12);
      header = 16;
    } else if (size === 0) size = end - i;
    if (size < header) break;
    out.push({ type: String.fromCharCode(...bytes.subarray(i + 4, i + 8)), body: i + header, end: Math.min(end, i + size) });
    i += size;
  }
  return out;
}

/** A (mvhd or mdhd) header's duration in ms: both keep timescale and duration at the same offsets. */
function headerMs(bytes: Uint8Array, p: number, end: number): number | null {
  if (bytes[p] === 1) {
    if (p + 32 > end) return null;
    const timescale = u32(bytes, p + 20);
    return timescale > 0 ? ((u32(bytes, p + 24) * 2 ** 32 + u32(bytes, p + 28)) / timescale) * 1000 : null;
  }
  if (p + 20 > end) return null;
  const timescale = u32(bytes, p + 12);
  return timescale > 0 ? (u32(bytes, p + 16) / timescale) * 1000 : null;
}

/** An MP4's movie length (mvhd) and each track's own length (trak/mdia/mdhd), from bytes holding its moov box. */
export function mp4Durations(bytes: Uint8Array): { movieMs: number | null; trackMs: number[] } | null {
  const moov = boxes(bytes, 0, bytes.length).find((b) => b.type === "moov");
  if (!moov) return null;
  const inside = boxes(bytes, moov.body, moov.end);
  const mvhd = inside.find((b) => b.type === "mvhd");
  const trackMs = inside
    .filter((b) => b.type === "trak")
    .flatMap((trak) => {
      const mdia = boxes(bytes, trak.body, trak.end).find((b) => b.type === "mdia");
      const mdhd = mdia && boxes(bytes, mdia.body, mdia.end).find((b) => b.type === "mdhd");
      const ms = mdhd ? headerMs(bytes, mdhd.body, mdhd.end) : null;
      return ms !== null && ms > 0 ? [ms] : [];
    });
  return { movieMs: mvhd ? headerMs(bytes, mvhd.body, mvhd.end) : null, trackMs };
}

/**
 * The length to trust: the longest of the movie and its tracks (a short movie header cannot hide a long track). Null
 * when nothing is known or the tracks and the movie disagree by more than 10% (an edited or forged header).
 */
export function trustedLengthMs(d: { movieMs: number | null; trackMs: number[] } | null): number | null {
  if (!d) return null;
  const all = [...(d.movieMs ? [d.movieMs] : []), ...d.trackMs];
  if (all.length === 0) return null;
  const longest = Math.max(...all);
  if (d.movieMs && d.trackMs.length && Math.abs(Math.max(...d.trackMs) - d.movieMs) > longest * 0.1) return null;
  return longest;
}

/**
 * An MP4's (or MOV's) movie and track lengths without downloading it: walks the top-level boxes with small ranged
 * reads until the movie box, then reads only that box (at most `maxMoovBytes`). `read(start, length)` returns those
 * bytes or null.
 */
export async function probeMp4Durations(read: (start: number, length: number) => Promise<Uint8Array | null>, size: number, maxMoovBytes = 8 * 1024 * 1024): Promise<{ movieMs: number | null; trackMs: number[] } | null> {
  let offset = 0;
  for (let count = 0; offset + 8 <= size && count < 64; count++) {
    const head = await read(offset, 16);
    if (!head || head.length < 8) return null;
    let boxSize = u32(head, 0);
    const type = String.fromCharCode(...head.subarray(4, 8));
    if (boxSize === 1) {
      if (head.length < 16) return null;
      boxSize = u32(head, 8) * 2 ** 32 + u32(head, 12);
    } else if (boxSize === 0) boxSize = size - offset;
    if (boxSize < 8) return null;
    if (type === "moov") {
      if (boxSize > maxMoovBytes) return null;
      const moov = await read(offset, boxSize);
      return moov ? mp4Durations(moov) : null;
    }
    offset += boxSize;
  }
  return null;
}
