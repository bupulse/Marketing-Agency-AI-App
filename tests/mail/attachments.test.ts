import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { columnName, decodeText, fileKind, guessDelimiter, inlineContentType, parseDelimited, parseRange, sandboxable, tokenizeCode } from "@/lib/mail/attachment-kinds";
import { buildZip, crc32, readZipDirectory, uniqueZipNames, zipEntryData } from "@/lib/mail/zip";

const enc = new TextEncoder();

describe("file kinds", () => {
  it("decides by extension first, then by the stated type", () => {
    expect(fileKind("Form.PDF", "application/octet-stream")).toBe("pdf");
    expect(fileKind("scan", "application/pdf")).toBe("pdf");
    expect(fileKind("photo.jpeg", "application/octet-stream")).toBe("image");
    expect(fileKind("clip.mov", "")).toBe("video");
    expect(fileKind("voice.m4a", "audio/x-m4a")).toBe("audio");
    expect(fileKind("leads.csv", "text/plain")).toBe("csv");
    expect(fileKind("list.tsv", "")).toBe("csv");
    expect(fileKind("pay.xlsx", "application/octet-stream")).toBe("sheet");
    expect(fileKind("old.xls", "")).toBe("sheet");
    expect(fileKind("letter.docx", "")).toBe("docx");
    expect(fileKind("letter.doc", "application/msword")).toBe("oldword");
    expect(fileKind("pitch.pptx", "")).toBe("slides");
    expect(fileKind("stand.blend", "")).toBe("blender");
    expect(fileKind("box.glb", "")).toBe("model");
    expect(fileKind("brand.zip", "")).toBe("zip");
    expect(fileKind("hook.json", "")).toBe("text");
    expect(fileKind("page.html", "text/html")).toBe("text");
    expect(fileKind("logo.svg", "image/svg+xml")).toBe("text");
    expect(fileKind("noname", "image/png")).toBe("image");
    expect(fileKind("noname", "text/csv")).toBe("csv");
    expect(fileKind("setup.exe", "application/x-msdownload")).toBe("other");
  });

  it("never serves HTML or SVG as a page; text is plain text", () => {
    expect(inlineContentType("page.html", "text/html")).toBe("text/plain; charset=utf-8");
    expect(inlineContentType("logo.svg", "image/svg+xml")).toBe("text/plain; charset=utf-8");
    expect(inlineContentType("x.csv", "text/csv")).toBe("text/plain; charset=utf-8");
    expect(inlineContentType("a.pdf", "application/octet-stream")).toBe("application/pdf");
    expect(inlineContentType("a.jpg", "application/octet-stream")).toBe("image/jpeg");
    expect(inlineContentType("a.png", "image/png")).toBe("image/png");
    expect(inlineContentType("v.mp4", "application/octet-stream")).toBe("video/mp4");
    expect(inlineContentType("v.m4a", "audio/x-m4a")).toBe("audio/x-m4a");
    expect(inlineContentType("a.docx", "")).toBeNull();
    expect(inlineContentType("a.exe", "text/html")).toBe("text/plain; charset=utf-8");
    expect(inlineContentType("a.bin", "application/octet-stream")).toBeNull();
  });

  it("keeps the sandbox on everything but PDF and media", () => {
    expect(sandboxable("application/pdf")).toBe(false);
    expect(sandboxable("video/mp4")).toBe(false);
    expect(sandboxable("audio/mpeg")).toBe(false);
    expect(sandboxable("image/png")).toBe(true);
    expect(sandboxable("text/plain; charset=utf-8")).toBe(true);
    expect(sandboxable(null)).toBe(true);
  });
});

describe("CSV", () => {
  it("reads quotes, doubled quotes and line breaks inside quotes", () => {
    const { rows, total } = parseDelimited('name,note\r\n"Aline, M.","said ""hi""\nthen left"\nJean,\n');
    expect(rows).toEqual([["name", "note"], ["Aline, M.", 'said "hi"\nthen left'], ["Jean", ""]]);
    expect(total).toBe(3);
  });
  it("guesses tabs and semicolons", () => {
    expect(guessDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(guessDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(guessDelimiter("a,b\n")).toBe(",");
    expect(guessDelimiter("a,b", "x.tsv")).toBe("\t");
    expect(parseDelimited("a;b\n1;2").rows).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("keeps the first rows and counts the rest", () => {
    const text = Array.from({ length: 1200 }, (_, i) => `${i},x`).join("\n");
    const r = parseDelimited(text, { maxRows: 500 });
    expect(r.rows.length).toBe(500);
    expect(r.total).toBe(1200);
    expect(r.rows[499]).toEqual(["499", "x"]);
  });
  it("strips a byte-order mark", () => {
    expect(parseDelimited("﻿a,b").rows[0][0]).toBe("a");
  });
  it("names columns like a spreadsheet", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });
});

describe("text files", () => {
  it("decodes UTF-8 and UTF-16, refuses binary", () => {
    expect(decodeText(enc.encode("Muraho ✓"))).toBe("Muraho ✓");
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]))).toBe("hi");
    expect(decodeText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]))).toBeNull();
  });
  it("colours code and splits it into lines", () => {
    const lines = tokenizeCode('{\n  "event": "order.paid",\n  "amount": 59000\n}', "hook.json");
    expect(lines.length).toBe(4);
    expect(lines[1]).toContainEqual({ t: "p", v: '"event"' });
    expect(lines[1]).toContainEqual({ t: "s", v: '"order.paid"' });
    expect(lines[2]).toContainEqual({ t: "n", v: "59000" });
    const js = tokenizeCode("// hi\nconst a = 'x'; /* two\nlines */", "a.ts");
    expect(js[0]).toEqual([{ t: "c", v: "// hi" }]);
    expect(js[1][0]).toEqual({ t: "k", v: "const" });
    expect(js[2]).toEqual([{ t: "c", v: "lines */" }]);
    expect(tokenizeCode("a\nb", "notes.txt")).toEqual([[{ t: "", v: "a" }], [{ t: "", v: "b" }]]);
  });
});

describe("byte ranges", () => {
  it("reads single ranges", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-1", 100)).toEqual({ start: 0, end: 1 });
    expect(parseRange("bytes=10-", 100)).toEqual({ start: 10, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange("bytes=100-", 100)).toBe("bad");
    expect(parseRange("bytes=5-2", 100)).toBe("bad");
    expect(parseRange("items=1-2", 100)).toBe("bad");
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
  });
});

describe("ZIP", () => {
  it("computes CRC-32", () => {
    expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
  it("makes names safe and unique", () => {
    expect(uniqueZipNames(["a.pdf", "A.pdf", "../x/y.txt", "a.pdf", ""])).toEqual(["a.pdf", "A (2).pdf", "_x_y.txt", "a (3).pdf", "file"]);
  });
  it("writes an archive it can read back", async () => {
    const files = [
      { name: "Fiche d’inscription.pdf", text: "%PDF-1.4 hello" },
      { name: "notes.txt", text: "Muraho\n".repeat(50) },
      { name: "notes.txt", text: "second" },
    ];
    const zip = await buildZip(files.map((f) => ({ name: f.name, date: new Date("2026-11-24T08:00:00Z"), bytes: async () => enc.encode(f.text) })));
    const list = readZipDirectory(zip);
    expect(list.map((e) => e.name)).toEqual(["Fiche d’inscription.pdf", "notes.txt", "notes (2).txt"]);
    expect(list.map((e) => e.size)).toEqual(files.map((f) => enc.encode(f.text).length));
    expect(list.every((e) => e.method === 0 && !e.encrypted && !e.dir)).toBe(true);
    expect(new TextDecoder().decode(zipEntryData(zip, list[2]))).toBe("second");
  });
  it("is accepted by the system unzip tool", async () => {
    let unzip = "";
    try {
      unzip = execFileSync("which", ["unzip"]).toString().trim();
    } catch {
      return; // not installed here
    }
    const zip = await buildZip([{ name: "a.txt", bytes: async () => enc.encode("one") }, { name: "b.txt", bytes: async () => enc.encode("two") }]);
    const dir = mkdtempSync(join(tmpdir(), "bmail-zip-"));
    writeFileSync(join(dir, "t.zip"), zip);
    const out = execFileSync(unzip, ["-t", join(dir, "t.zip")]).toString();
    expect(out).toMatch(/No errors detected/);
  });
  it("refuses bytes that are not a ZIP", () => {
    expect(() => readZipDirectory(enc.encode("hello"))).toThrow(/not a ZIP/);
  });
});
