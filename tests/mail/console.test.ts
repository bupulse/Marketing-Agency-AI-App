import { describe, expect, it } from "vitest";
import { addressProblem, avatarColor, firstNames, formatMb, forwardShort, forwardWhere, isQuota, ourAddressFrom, quotaUse, senderPattern, stepQuota, storageByMember, storageSummary } from "@/lib/mail/console-rules";
import { isSignatureLook, SIGNATURE_LOOKS, signatureHtml, signatureHtmlFor } from "@/lib/mail/signature-render";

const MB = 1024 * 1024;

describe("storage allowances", () => {
  it("steps through the allowed quotas and stops at the ends", () => {
    expect(stepQuota(250, 1)).toBe(500);
    expect(stepQuota(250, -1)).toBe(100);
    expect(stepQuota(1000, 1)).toBeNull();
    expect(stepQuota(50, -1)).toBeNull();
  });
  it("never goes below what the person already uses", () => {
    expect(stepQuota(250, -1, 120)).toBeNull();
    expect(stepQuota(250, -1, 99)).toBe(100);
    expect(stepQuota(500, 1, 900)).toBe(1000);
  });
  it("snaps an odd value to the nearest step", () => {
    expect(stepQuota(300, 1)).toBe(500);
    expect(stepQuota(300, -1)).toBe(250);
    expect(stepQuota(2000, 1)).toBeNull();
    expect(isQuota(300)).toBe(false);
    expect(isQuota(500)).toBe(true);
  });
  it("formats sizes like the design", () => {
    expect(formatMb(250)).toBe("250 MB");
    expect(formatMb(1000)).toBe("1 GB");
    expect(formatMb(1500)).toBe("1.5 GB");
    expect(formatMb(4.25)).toBe("4.3 MB");
    expect(formatMb(0)).toBe("0 MB");
  });
});

describe("storage used", () => {
  it("sums each member's own mailbox and ignores shared ones", () => {
    const boxes = [{ id: "b1", memberId: "m1" }, { id: "b2", memberId: "m2" }, { id: "s", memberId: null }];
    const sums = [{ mailboxId: "b1", bytes: 10 * MB }, { mailboxId: "s", bytes: 99 * MB }];
    expect(storageByMember(boxes, sums)).toEqual({ m1: 10 * MB, m2: 0 });
  });
  it("summarises the pool: given, used, left and over", () => {
    const s = storageSummary([500, 250, 250, 250], 300 * MB, 1000);
    expect(s.givenMb).toBe(1250);
    expect(s.over).toBe(true);
    expect(s.leftMb).toBe(0);
    expect(s.usedPct).toBe(30);
    expect(s.givenPct).toBe(100);
    expect(storageSummary([250], 0, 1000).leftMb).toBe(750);
  });
  it("warns above 80% of an allowance", () => {
    expect(quotaUse(81 * MB, 100)).toEqual({ pct: 81, warn: true });
    expect(quotaUse(500 * MB, 250).pct).toBe(100);
    expect(quotaUse(10 * MB, 100).warn).toBe(false);
  });
});

describe("addresses in the console", () => {
  it("reads extra addresses as ours only", () => {
    expect(ourAddressFrom("Info")).toBe("info@bupulse.com");
    expect(ourAddressFrom(" hello@BuPulse.com ")).toBe("hello@bupulse.com");
    expect(ourAddressFrom("info@gmail.com")).toBeNull();
    expect(ourAddressFrom("info@mail.bupulse.com")).toBeNull();
    expect(ourAddressFrom("-bad")).toBeNull();
    expect(ourAddressFrom("")).toBeNull();
  });
  it("says why an address is taken, and frees an unowned personal mailbox for a new user", () => {
    const none = { mailboxes: [], members: [], aliases: [] };
    expect(addressProblem("a@bupulse.com", none)).toBeNull();
    expect(addressProblem("a@bupulse.com", { ...none, members: ["a@bupulse.com"] })).toMatch(/already has B Mail/);
    expect(addressProblem("a@bupulse.com", { ...none, aliases: ["a@bupulse.com"] })).toMatch(/extra address/);
    expect(addressProblem("a@bupulse.com", { ...none, mailboxes: ["a@bupulse.com"] })).toMatch(/taken/);
    expect(addressProblem("a@bupulse.com", { ...none, mailboxes: ["a@bupulse.com"] }, { unownedPersonal: ["a@bupulse.com"] })).toBeNull();
  });
  it("reads sender rule patterns as an address or @domain", () => {
    expect(senderPattern("Offers@Example.com")).toBe("offers@example.com");
    expect(senderPattern("@Example.com")).toBe("@example.com");
    expect(senderPattern("example.com")).toBe("@example.com");
    expect(senderPattern("not a domain")).toBeNull();
    expect(senderPattern("")).toBeNull();
  });
});

describe("forwarding labels", () => {
  it("shortens our addresses and marks kept copies", () => {
    expect(forwardShort("cyusa@bupulse.com", true)).toBe("cyusa@ (copy)");
    expect(forwardShort("office@bupulse.com", false)).toBe("office@");
    expect(forwardShort("help@example.org", false)).toBe("help@example.org");
  });
  it("says where the mail lands", () => {
    expect(forwardWhere({ external: false, keepCopy: true }, "Grace")).toBe('Folder "Grace" + All inboxes · kept for Grace');
    expect(forwardWhere({ external: true, keepCopy: false }, "Support")).toBe("Outside address · Not kept for Support");
  });
  it("gives steady avatar colours and short name lists", () => {
    expect(avatarColor("grace@bupulse.com")).toBe(avatarColor("grace@bupulse.com"));
    expect(firstNames(["Grace Uwimana", "Eric N"])).toBe("Grace, Eric");
    expect(firstNames(["A", "B", "C", "D", "E", "F"], 4)).toBe("A, B, C, D and 2 more");
  });
});

describe("signature looks", () => {
  const company = { website: "bupulse.com", address: "Kigali, Rwanda", companyPhone: "+250 788 000 000", linkedinUrl: "linkedin.com/company/bupulse", instagramUrl: null, facebookUrl: "facebook.com/bupulse", ctaText: "Get your free BuPulse quote", ctaUrl: "https://bupulse.com/quote", logoUrl: "https://bupulse.com/brand/logo.png" };
  const person = { name: "<b>Grace</b>", title: "Support", email: "grace@bupulse.com", mobile: "+250 788 111 222", extra: "Mon to Sat" };
  it("lists 5 looks with Classic first", () => {
    expect(SIGNATURE_LOOKS.map((l) => l.id)).toEqual(["classic", "compact", "card", "simple", "banner"]);
    expect(isSignatureLook("card")).toBe(true);
    expect(isSignatureLook("fancy")).toBe(false);
  });
  it("keeps Classic exactly as before, also for unknown or missing looks", () => {
    expect(signatureHtmlFor("classic", company, person)).toBe(signatureHtml(company, person));
    expect(signatureHtmlFor(undefined, company, person)).toBe(signatureHtml(company, person));
    expect(signatureHtmlFor("fancy", company, person)).toBe(signatureHtml(company, person));
  });
  it("escapes the person's lines in every look and shows their phone and the company phone", () => {
    for (const { id } of SIGNATURE_LOOKS) {
      const h = signatureHtmlFor(id, company, person);
      expect(h).not.toContain("<b>Grace</b>");
      expect(h).toContain("&lt;b&gt;Grace&lt;/b&gt;");
      expect(h).toContain("Mobile +250 788 111 222");
      expect(h).toContain("Mon to Sat");
    }
  });
  it("uses the mark for Compact and the white logo for Banner", () => {
    expect(signatureHtmlFor("compact", company, person)).toContain("https://bupulse.com/brand/mark.png");
    expect(signatureHtmlFor("banner", company, person)).toContain("https://bupulse.com/brand/logo-white.png");
    expect(signatureHtmlFor("banner", { ...company, logoUrl: "https://cdn.x/l.svg" }, person)).toContain("https://cdn.x/l.svg");
    expect(signatureHtmlFor("simple", company, person)).not.toContain("<img");
  });
});
