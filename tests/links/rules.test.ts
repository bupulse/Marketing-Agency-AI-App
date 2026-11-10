import { describe, expect, it } from "vitest";
import { cleanDestination, codeFromLabel, landingUrl, leadOwnerOf, leadOwnerText, normalizeCode, shortLink } from "@/lib/links/rules";

describe("link codes", () => {
  it("tidies what people type", () => {
    expect(normalizeCode("IG Bio")).toBe("ig-bio");
    expect(normalizeCode("  Jean's WhatsApp!! ")).toBe("jean-s-whatsapp");
    expect(normalizeCode("Café-Kigali")).toBe("cafe-kigali");
  });
  it("refuses codes that are too short or empty", () => {
    expect(normalizeCode("ab")).toBeNull();
    expect(normalizeCode("---")).toBeNull();
    expect(normalizeCode("")).toBeNull();
  });
  it("makes one from the label with a random tail", () => {
    expect(codeFromLabel("Jean WhatsApp", () => 0)).toBe("jean-whatsapp-aaaa");
    expect(codeFromLabel("!!", () => 0)).toBe("link-aaaa");
    expect(normalizeCode(codeFromLabel("A very long name that keeps going and going forever"))).not.toBeNull();
  });
});

describe("link pages", () => {
  it("takes paths of the site only", () => {
    expect(cleanDestination("/pricing")).toBe("/pricing");
    expect(cleanDestination("/quote?x=1")).toBe("/quote?x=1");
    for (const bad of ["https://evil.com", "//evil.com", "pricing", "/\\evil.com", "/a b", "/admin", "/support/chats", "/api/x", "/go/abc", "/dashboard"]) {
      expect(cleanDestination(bad)).toBeNull();
    }
  });
  it("opens the page with utm tags and the quote source, keeping tags already there", () => {
    const url = landingUrl({ destination: "/pricing?utm_campaign=keep", channel: "instagram", code: "ig-bio" }, "https://bupulse.com");
    expect(url.origin + url.pathname).toBe("https://bupulse.com/pricing");
    expect(url.searchParams.get("utm_source")).toBe("instagram");
    expect(url.searchParams.get("utm_medium")).toBe("link");
    expect(url.searchParams.get("utm_campaign")).toBe("keep");
    expect(url.searchParams.get("src")).toBe("instagram");
    expect(shortLink("https://bupulse.com/", "ig-bio")).toBe("https://bupulse.com/go/ig-bio");
  });
});

describe("whose lead", () => {
  const staffLink = { byId: "jean", byName: "Jean", byOwner: false };
  const companyLink = { byId: "owner", byName: "Admin", byOwner: true };
  const aline = { id: "aline", name: "Aline", owner: false };

  it("organic visitors and company links are the company's", () => {
    expect(leadOwnerOf(null, null)).toEqual({ kind: "company" });
    expect(leadOwnerOf(companyLink, null)).toEqual({ kind: "company" });
    expect(leadOwnerOf(null, { id: "owner", name: "Admin", owner: true })).toEqual({ kind: "company" });
    expect(leadOwnerText({ kind: "company" })).toBe("BuPulse (company)");
  });
  it("a staff member's link makes it theirs, even if someone else chatted", () => {
    expect(leadOwnerOf(staffLink, aline)).toEqual({ kind: "staff", agentId: "jean", name: "Jean", via: "link" });
  });
  it("a staff member who talked to an organic visitor (or one from a company link) gets the lead", () => {
    expect(leadOwnerOf(null, aline)).toEqual({ kind: "staff", agentId: "aline", name: "Aline", via: "chat" });
    expect(leadOwnerText(leadOwnerOf(companyLink, aline))).toBe("Aline (talked in the chat)");
  });
});
