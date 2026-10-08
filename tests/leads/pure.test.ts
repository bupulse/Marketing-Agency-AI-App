import { describe, expect, it } from "vitest";
import { csvCell, leadsToCsv } from "@/lib/leads/csv";
import { leadWhere, parseFilters } from "@/lib/leads/filters";
import { normalizeEmail, normalizePhone, whatsappLink } from "@/lib/leads/normalize";
import { timeAgo } from "@/components/leads/format";

describe("normalize", () => {
  it("lower-cases emails and drops malformed ones", () => {
    expect(normalizeEmail("  Jane@Example.COM ")).toBe("jane@example.com");
    for (const bad of ["jane", "a@b", "a b@c.com", "<x>@y.com", 5, null]) expect(normalizeEmail(bad)).toBeUndefined();
  });
  it("normalises phones", () => {
    expect(normalizePhone("+250 788-123.456")).toBe("+250788123456");
    expect(normalizePhone("(078) 812 3456")).toBe("0788123456");
    expect(normalizePhone("00250788123456")).toBe("+250788123456");
    for (const bad of ["123", "call me", "1".repeat(20), ""]) expect(normalizePhone(bad)).toBeUndefined();
  });
  it("makes wa.me links from digits only", () => {
    expect(whatsappLink("+250788123456")).toBe("https://wa.me/250788123456");
    expect(whatsappLink(null)).toBeNull();
    expect(whatsappLink("12")).toBeNull();
  });
});

describe("csv", () => {
  it("quotes per RFC 4180", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe("");
    expect(csvCell("plain")).toBe("plain");
  });
  it.each(["=SUM(A1)", "+1+1", "-2", "@cmd", "\tx", "\rx"])("defuses formula %j", (value) => {
    expect(csvCell(value).replace(/^"/, "").startsWith("'")).toBe(true);
  });
  it("leaves normalised phone numbers readable but still defuses lookalikes", () => {
    expect(csvCell("+250788123456")).toBe("+250788123456");
    expect(csvCell("+250788123456+1")).toBe("'+250788123456+1");
    expect(csvCell("+12345")).toBe("'+12345");
    expect(csvCell("+1234567\n=1")).toBe("\"'+1234567\n=1\"");
  });
  it("defuses and quotes together", () => {
    expect(csvCell('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`);
  });
  it("builds a file with BOM, header and CRLF", () => {
    const csv = leadsToCsv([{ id: "l1", createdAt: new Date("2026-10-08T08:00:00Z"), name: "=evil", email: "a@b.co", phone: null, interest: "Cakes, big", message: null, source: "website_chat", status: "NEW", notes: null, pageUrl: null }]);
    expect(csv.startsWith("﻿Date,Name")).toBe(true);
    expect(csv.split("\r\n")[1]).toBe(`2026-10-08T08:00:00.000Z,'=evil,a@b.co,,"Cakes, big",,website_chat,NEW,,,l1`);
  });
});

describe("filters", () => {
  it("parses and ignores junk", () => {
    expect(parseFilters({ status: "won", source: "website_chat", q: " cake " })).toEqual({ status: "WON", source: "website_chat", q: "cake" });
    expect(parseFilters({ status: "HACK", source: "a;drop", q: "" })).toEqual({});
    expect(parseFilters(new URLSearchParams("status=lost"))).toEqual({ status: "LOST" });
  });
  it("always scopes by business, whatever the filters", () => {
    const where = leadWhere("b1", { status: "NEW", source: "instagram", q: "x" });
    expect(where.businessId).toBe("b1");
    expect(where.status).toBe("NEW");
    expect(where.OR).toHaveLength(6);
    expect(leadWhere("b2")).toEqual({ businessId: "b2" });
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  it("reads naturally", () => {
    expect(timeAgo(new Date(now - 10_000), now)).toBe("just now");
    expect(timeAgo(new Date(now - 5 * 60_000), now)).toBe("5m ago");
    expect(timeAgo(new Date(now - 3 * 3600_000), now)).toBe("3h ago");
    expect(timeAgo(new Date(now - 2 * 86400_000), now)).toBe("2d ago");
  });
});
