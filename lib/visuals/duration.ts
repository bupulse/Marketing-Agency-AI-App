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
export function webmDurationMs(bytes: Uint8Array): number | null {
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
  return last >= 0 ? (last * scale) / 1_000_000 + 33 : null;
}

export function videoDurationMs(bytes: Uint8Array, type: "video/mp4" | "video/webm"): number | null {
  try {
    return type === "video/mp4" ? mp4DurationMs(bytes) : webmDurationMs(bytes);
  } catch {
    return null;
  }
}
