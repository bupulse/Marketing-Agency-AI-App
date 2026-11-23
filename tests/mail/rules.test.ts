import { describe, expect, it } from "vitest";
import { canUseMail, sendableDepartmentIds, visibleMailboxIds, type MailboxRow, type Viewer } from "@/lib/mail/access-rules";
import { replyRecipients } from "@/lib/mail/compose-rules";
import { signatureHtml, signatureText } from "@/lib/mail/signature-render";
import { quoteBlock, safeEmailDocument, textToHtml } from "@/lib/mail/html";


const boxes: MailboxRow[] = [
  { id: "own", kind: "personal", visibility: "members", departmentId: null, memberId: "m1" },
  { id: "someone", kind: "personal", visibility: "members", departmentId: null, memberId: "m2" },
  { id: "support", kind: "shared", visibility: "everyone", departmentId: "d_sup", memberId: null },
  { id: "sales", kind: "shared", visibility: "department", departmentId: "d_sales", memberId: null },
  { id: "accounting", kind: "shared", visibility: "department", departmentId: "d_acc", memberId: null },
  { id: "other", kind: "catchall", visibility: "members", departmentId: null, memberId: null },
];
const member = (over: Partial<NonNullable<Viewer["member"]>> = {}): Viewer => ({ isOwner: false, grants: [], member: { id: "m1", role: "member", departmentId: "d_sales", status: "active", mail: true, ...over } });

describe("who sees what", () => {
  it("owner and mail admins see everything", () => {
    expect(visibleMailboxIds({ isOwner: true, member: null, grants: [] }, boxes)).toHaveLength(6);
    expect(visibleMailboxIds(member({ role: "admin" }), boxes)).toHaveLength(6);
  });
  it("a member sees their own, support@ and their department, never the catch-all", () => {
    expect(visibleMailboxIds(member(), boxes).sort()).toEqual(["own", "sales", "support"]);
    expect(visibleMailboxIds(member({ departmentId: "d_acc" }), boxes).sort()).toEqual(["accounting", "own", "support"]);
  });
  it("grants add mailboxes one by one; suspended or Mail-off members see nothing", () => {
    expect(visibleMailboxIds({ ...member(), grants: ["someone"] }, boxes)).toContain("someone");
    expect(visibleMailboxIds(member({ status: "suspended" }), boxes)).toEqual([]);
    expect(canUseMail(member({ mail: false }))).toBe(false);
    expect(canUseMail({ isOwner: false, member: null, grants: [] })).toBe(false);
  });
  it("department sending: admins any, heads their own, members none", () => {
    const depts = [{ id: "d_sales", headMemberId: "m1" }, { id: "d_acc", headMemberId: "m9" }];
    expect(sendableDepartmentIds(member({ role: "admin" }), depts)).toEqual(["d_sales", "d_acc"]);
    expect(sendableDepartmentIds(member(), depts)).toEqual(["d_sales"]);
    expect(sendableDepartmentIds(member({ id: "m5" }), depts)).toEqual([]);
  });
});

describe("reply recipients", () => {
  const parent = { fromName: "Jean", fromAddress: "jb@hub.rw", replyTo: null, to: [{ name: "", address: "cyusa@bupulse.com" }, { name: "Grace", address: "grace@bupulse.com" }], cc: [{ name: "Patrick", address: "p@hub.rw" }, { name: "", address: "cyusa@bupulse.com" }], subject: "Workshops", direction: "in" };
  it("reply goes to the sender only", () => {
    expect(replyRecipients(parent, "reply", "cyusa@bupulse.com")).toEqual({ to: [{ name: "Jean", address: "jb@hub.rw" }], cc: [], subject: "Re: Workshops" });
  });
  it("reply all adds To and Cc without our own address", () => {
    const r = replyRecipients(parent, "all", "cyusa@bupulse.com");
    expect(r.to.map((a) => a.address)).toEqual(["jb@hub.rw"]);
    expect(r.cc.map((a) => a.address)).toEqual(["grace@bupulse.com", "p@hub.rw"]);
  });
  it("uses Reply-To, re-sends to recipients of our own mail, forwards to nobody", () => {
    expect(replyRecipients({ ...parent, replyTo: "help@hub.rw" }, "reply", "cyusa@bupulse.com").to[0].address).toBe("help@hub.rw");
    expect(replyRecipients({ ...parent, direction: "out", fromAddress: "cyusa@bupulse.com" }, "reply", "cyusa@bupulse.com").to.map((a) => a.address)).toEqual(["grace@bupulse.com"]);
    expect(replyRecipients(parent, "forward", "cyusa@bupulse.com")).toEqual({ to: [], cc: [], subject: "Fwd: Workshops" });
  });
});

describe("signature and html", () => {
  const company = { website: "bupulse.com", address: "Kigali, Rwanda", companyPhone: "+250 788 000 000", linkedinUrl: "linkedin.com/company/bupulse", instagramUrl: null, facebookUrl: null, ctaText: "Get your free BuPulse quote", ctaUrl: "https://bupulse.com/quote", logoUrl: "https://bupulse.com/brand/logo.png" };
  it("puts the locked company phone and the person's mobile in", () => {
    const t = signatureText(company, { name: "Grace", title: "Support", email: "grace@bupulse.com", mobile: "+250 788 111 222", extra: null });
    expect(t).toContain("Office +250 788 000 000 | Mobile +250 788 111 222");
    const h = signatureHtml(company, { name: "<b>Grace</b>", title: null, email: "grace@bupulse.com", mobile: null, extra: null });
    expect(h).toContain("&lt;b&gt;Grace&lt;/b&gt;");
    expect(h).toContain('href="https://linkedin.com/company/bupulse"');
    expect(h).not.toContain("Mobile");
  });
  it("escapes typed text, quotes earlier messages, strips scripts and blocks remote images by default", () => {
    expect(textToHtml("a <b>\n\nhttps://x.rw")).toBe('<p style="margin:0 0 1em">a &lt;b&gt;</p><p style="margin:0 0 1em"><a href="https://x.rw">https://x.rw</a></p>');
    expect(quoteBlock({ date: new Date("2026-11-23T08:00:00Z"), fromName: "Jean", fromAddress: "jb@hub.rw", text: "hi\nthere" }).text).toMatch(/wrote:\n> hi\n> there$/);
    const d = safeEmailDocument('<img src="https://t.x/p.gif" onerror="alert(1)"><script>alert(1)</script>', { allowRemote: false });
    expect(d).not.toContain("<script>");
    expect(d).not.toContain("onerror");
    expect(d).toContain("img-src data: blob: 'self'");
  });
});
