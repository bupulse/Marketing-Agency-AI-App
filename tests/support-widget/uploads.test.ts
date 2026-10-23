import { describe, expect, it } from "vitest";
import { checkFinal, checkUpload, formatBytes, formatDuration, needsShrink, pickVoiceType, shrinkSize, uploadKind, waveform } from "@/lib/support/client/uploads";
import { checkPrechat, rwandaWhatsapp } from "@/lib/support/client/prechat";

const MB = 1024 * 1024;

describe("upload checks", () => {
  it("knows photos, PDFs and voice notes", () => {
    expect(uploadKind("image/jpeg")).toBe("image");
    expect(uploadKind("image/webp")).toBe("image");
    expect(uploadKind("application/pdf")).toBe("file");
    expect(uploadKind("audio/webm;codecs=opus")).toBe("voice");
    expect(uploadKind("image/gif")).toBeNull();
    expect(uploadKind("application/zip")).toBeNull();
  });

  it("accepts photos of any size before shrinking, PDFs up to 10 MB", () => {
    expect(checkUpload({ type: "image/jpeg", size: 25 * MB })).toEqual({ ok: true, kind: "image" });
    expect(checkUpload({ type: "image/heic", size: 3 * MB })).toEqual({ ok: true, kind: "image" });
    expect(checkUpload({ type: "application/pdf", size: 10 * MB })).toEqual({ ok: true, kind: "file" });
    expect(checkUpload({ type: "application/pdf", size: 10 * MB + 1 }).ok).toBe(false);
    expect(checkUpload({ type: "text/html", size: 100 }).ok).toBe(false);
    expect(checkUpload({ type: "image/png", size: 0 }).ok).toBe(false);
    // A voice note is recorded, never picked as a file.
    expect(checkUpload({ type: "audio/mpeg", size: 100 }).ok).toBe(false);
  });

  it("checks the final file against UPLOAD_LIMITS", () => {
    expect(checkFinal({ type: "image/jpeg", size: 400 * 1024 })).toEqual({ ok: true, kind: "image" });
    expect(checkFinal({ type: "image/jpeg", size: 11 * MB }).ok).toBe(false);
    expect(checkFinal({ type: "image/heic", size: 100 }).ok).toBe(false);
    expect(checkFinal({ type: "audio/mp4", size: 300 * 1024 })).toEqual({ ok: true, kind: "voice" });
  });
});

describe("photo shrinking", () => {
  it("keeps the shape, caps the longest side at 1600 px and never enlarges", () => {
    expect(shrinkSize(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(shrinkSize(1170, 2532)).toEqual({ width: 739, height: 1600 });
    expect(shrinkSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(shrinkSize(3000, 10, 1000)).toEqual({ width: 1000, height: 3 });
    expect(shrinkSize(0, 100)).toEqual({ width: 0, height: 0 });
  });

  it("redraws big or heavy photos and iPhone HEIC, leaves small ones", () => {
    expect(needsShrink({ type: "image/jpeg", size: 200 * 1024 }, 800, 600)).toBe(false);
    expect(needsShrink({ type: "image/jpeg", size: 200 * 1024 }, 2000, 1000)).toBe(true);
    expect(needsShrink({ type: "image/png", size: 2 * MB }, 1200, 800)).toBe(true);
    expect(needsShrink({ type: "image/heic", size: 100 * 1024 }, 800, 600)).toBe(true);
  });
});

describe("voice notes and labels", () => {
  it("picks webm/opus first, then Safari's mp4", () => {
    expect(pickVoiceType(() => true)).toBe("audio/webm;codecs=opus");
    expect(pickVoiceType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickVoiceType(() => false)).toBeNull();
  });

  it("draws the same waveform for the same note", () => {
    const a = waveform("m1");
    expect(a).toHaveLength(16);
    expect(waveform("m1")).toEqual(a);
    expect(waveform("m2")).not.toEqual(a);
    expect(a.every((h) => h >= 0.12 && h <= 1)).toBe(true);
  });

  it("formats sizes and durations", () => {
    expect(formatBytes(240 * 1024)).toBe("240 KB");
    expect(formatBytes(3.5 * MB)).toBe("3.5 MB");
    expect(formatBytes(900)).toBe("900 B");
    expect(formatDuration(9)).toBe("0:09");
    expect(formatDuration(105)).toBe("1:45");
  });
});

describe("pre-chat form", () => {
  it("reads Rwandan WhatsApp numbers written in the usual ways", () => {
    expect(rwandaWhatsapp("788 123 456")).toBe("+250788123456");
    expect(rwandaWhatsapp("0788123456")).toBe("+250788123456");
    expect(rwandaWhatsapp("+250 788-123-456")).toBe("+250788123456");
    expect(rwandaWhatsapp("250788123456")).toBe("+250788123456");
    expect(rwandaWhatsapp("")).toBe("");
    expect(rwandaWhatsapp("12345")).toBeNull();
  });

  it("needs a name, a valid email and a business; WhatsApp is optional", () => {
    const ok = checkPrechat({ name: " Aline ", email: "aline@example.com", business: "Sample Beauty Salon", whatsapp: "" });
    expect(ok).toEqual({ ok: true, body: { name: "Aline", email: "aline@example.com", business: "Sample Beauty Salon" } });
    const bad = checkPrechat({ name: "", email: "nope", business: " ", whatsapp: "99" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["business", "email", "name", "whatsapp"]);
    const wa = checkPrechat({ name: "A", email: "a@example.com", business: "B", whatsapp: "0788 000 000" });
    expect(wa.ok && wa.body.whatsapp).toBe("+250788000000");
  });
});
