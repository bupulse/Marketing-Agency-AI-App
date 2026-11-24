// A small ZIP writer (for "Download all") and reader (to list a ZIP attachment's contents). Pure, no dependencies.
// Writing uses the "store" method (no compression): attachments are mostly PDFs, photos and Office files, which are
// compressed already. Up to 65,535 files and 4 GB (no ZIP64); far above an email's 20-file, 20 MB limit.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/** MS-DOS date and time (2-second steps), in Kigali time, which is what people's computers show. */
function dosTime(d: Date): { time: number; date: number } {
  const k = new Date(d.getTime() + 2 * 3600_000);
  const year = Math.max(1980, k.getUTCFullYear());
  return {
    time: (k.getUTCHours() << 11) | (k.getUTCMinutes() << 5) | (k.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((k.getUTCMonth() + 1) << 5) | k.getUTCDate(),
  };
}

/** Names inside the archive: no folders, no "..", unique ("report.pdf", "report (2).pdf"). */
export function uniqueZipNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((raw) => {
    const clean = raw.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/^\.+/, "").trim().slice(0, 180) || "file";
    let name = clean;
    const dot = clean.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ""];
    for (let n = 2; seen.has(name.toLowerCase()); n++) name = `${stem} (${n})${ext}`;
    seen.add(name.toLowerCase());
    return name;
  });
}

type Entry = { name: Uint8Array; crc: number; size: number; offset: number; time: number; date: number };

function localHeader(e: Entry): Uint8Array {
  const b = new Uint8Array(30 + e.name.length);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(4, 20, true); // version needed
  v.setUint16(6, 0x0800, true); // UTF-8 names
  v.setUint16(8, 0, true); // stored
  v.setUint16(10, e.time, true);
  v.setUint16(12, e.date, true);
  v.setUint32(14, e.crc, true);
  v.setUint32(18, e.size, true);
  v.setUint32(22, e.size, true);
  v.setUint16(26, e.name.length, true);
  v.setUint16(28, 0, true);
  b.set(e.name, 30);
  return b;
}

function centralDirectory(entries: Entry[], start: number): Uint8Array {
  const parts: Uint8Array[] = [];
  let size = 0;
  for (const e of entries) {
    const b = new Uint8Array(46 + e.name.length);
    const v = new DataView(b.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(4, 20, true); // made by
    v.setUint16(6, 20, true); // version needed
    v.setUint16(8, 0x0800, true);
    v.setUint16(10, 0, true);
    v.setUint16(12, e.time, true);
    v.setUint16(14, e.date, true);
    v.setUint32(16, e.crc, true);
    v.setUint32(20, e.size, true);
    v.setUint32(24, e.size, true);
    v.setUint16(28, e.name.length, true);
    v.setUint32(38, 0, true); // external attributes
    v.setUint32(42, e.offset, true);
    b.set(e.name, 46);
    parts.push(b);
    size += b.length;
  }
  const end = new Uint8Array(22);
  const v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, entries.length, true);
  v.setUint16(10, entries.length, true);
  v.setUint32(12, size, true);
  v.setUint32(16, start, true);
  parts.push(end);
  return concat(parts);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export type ZipInput = { name: string; date?: Date; bytes: () => Promise<Uint8Array> };

/**
 * A ZIP archive as a stream: each file is fetched only when the previous one has been sent, so the server holds one
 * file at a time. Names are made unique and safe.
 */
export function zipStream(files: ZipInput[]): ReadableStream<Uint8Array> {
  if (files.length > 0xffff) throw new Error("too many files for one ZIP");
  const names = uniqueZipNames(files.map((f) => f.name));
  const enc = new TextEncoder();
  const entries: Entry[] = [];
  let offset = 0;
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i < files.length) {
        const f = files[i];
        const data = await f.bytes();
        if (offset + data.length + 1024 > 0xffffffff) throw new Error("ZIP too large");
        const { time, date } = dosTime(f.date ?? new Date());
        const e: Entry = { name: enc.encode(names[i]), crc: crc32(data), size: data.length, offset, time, date };
        entries.push(e);
        const head = localHeader(e);
        controller.enqueue(head);
        controller.enqueue(data);
        offset += head.length + data.length;
        i++;
        return;
      }
      controller.enqueue(centralDirectory(entries, offset));
      controller.close();
    },
  });
}

/** The whole archive at once (tests, small archives). */
export async function buildZip(files: ZipInput[]): Promise<Uint8Array> {
  const reader = zipStream(files).getReader();
  const parts: Uint8Array[] = [];
  for (let r = await reader.read(); !r.done; r = await reader.read()) parts.push(r.value);
  return concat(parts);
}

// ---------------------------------------------------------------------------------------------------------------
// Reading

export type ZipEntry = { name: string; size: number; compressedSize: number; method: number; offset: number; encrypted: boolean; dir: boolean };

const CP437_HIGH = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
const cp437 = (b: Uint8Array) => Array.from(b, (c) => (c < 128 ? String.fromCharCode(c) : CP437_HIGH[c - 128])).join("");

/** Lists a ZIP archive from its central directory (ZIP64 included). Throws when the bytes are not a ZIP. */
export function readZipDirectory(bytes: Uint8Array): ZipEntry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 22 - 0xffff); p--) {
    if (v.getUint32(p, true) === 0x06054b50) { eocd = p; break; }
  }
  if (eocd < 0) throw new Error("not a ZIP file");
  let count = v.getUint16(eocd + 10, true);
  let cdOffset = v.getUint32(eocd + 16, true);
  // ZIP64 end of central directory, through its locator just before the normal end record.
  if ((count === 0xffff || cdOffset === 0xffffffff) && eocd >= 20 && v.getUint32(eocd - 20, true) === 0x07064b50) {
    const z = Number(v.getBigUint64(eocd - 12, true));
    if (z + 56 <= bytes.length && v.getUint32(z, true) === 0x06064b50) {
      count = Number(v.getBigUint64(z + 32, true));
      cdOffset = Number(v.getBigUint64(z + 48, true));
    }
  }
  const out: ZipEntry[] = [];
  const utf8 = new TextDecoder("utf-8");
  let p = cdOffset;
  for (let n = 0; n < count && p + 46 <= bytes.length; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    let compressedSize = v.getUint32(p + 20, true);
    let size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    let offset = v.getUint32(p + 42, true);
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
    const name = flags & 0x0800 ? utf8.decode(nameBytes) : cp437(nameBytes);
    // ZIP64 sizes and offset live in extra field 0x0001, in this order, only for values that overflowed.
    for (let x = p + 46 + nameLen; x + 4 <= p + 46 + nameLen + extraLen;) {
      const id = v.getUint16(x, true);
      const len = v.getUint16(x + 2, true);
      if (id === 0x0001) {
        let q = x + 4;
        if (size === 0xffffffff) { size = Number(v.getBigUint64(q, true)); q += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = Number(v.getBigUint64(q, true)); q += 8; }
        if (offset === 0xffffffff) offset = Number(v.getBigUint64(q, true));
      }
      x += 4 + len;
    }
    out.push({ name, size, compressedSize, method, offset, encrypted: !!(flags & 1), dir: name.endsWith("/") });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** One entry's stored bytes (still compressed when method is 8, deflate). */
export function zipEntryData(bytes: Uint8Array, e: ZipEntry): Uint8Array {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(e.offset, true) !== 0x04034b50) throw new Error("damaged ZIP entry");
  const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
  return bytes.subarray(start, start + e.compressedSize);
}
