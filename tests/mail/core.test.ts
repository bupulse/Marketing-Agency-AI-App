import { describe, expect, it } from "vitest";
import { baseAddress, cleanAddress, formatAddress, parseAddressList, routeRecipient, type MailboxRef } from "@/lib/mail/addresses";
import { authSummary, htmlToText, makeSnippet, parseMime } from "@/lib/mail/parse";
import { signInbound, verifyInbound } from "@/lib/mail/signature";
import { cleanMessageId, forwardSubject, messageIdList, pickThread, replyReferences, replySubject, subjectKey } from "@/lib/mail/threading";

const MAILBOXES: MailboxRef[] = [
  { id: "mbx_cyusa", address: "cyusa@bupulse.com", kind: "personal" },
  { id: "mbx_sales", address: "sales@bupulse.com", kind: "shared" },
  { id: "mbx_other", address: null, kind: "catchall" },
];

describe("addresses and routing", () => {
  it("cleans addresses", () => {
    expect(cleanAddress("  Ana Example <ANA@Example.RW> ")).toBe("ana@example.rw");
    expect(cleanAddress("mailto:x@y.co")).toBe("x@y.co");
    expect(cleanAddress("not an address")).toBeNull();
    expect(cleanAddress("a@b")).toBeNull();
  });
  it("routes named, plus and catch-all recipients", () => {
    expect(routeRecipient("cyusa@bupulse.com", MAILBOXES)?.id).toBe("mbx_cyusa");
    expect(routeRecipient("Sales+quote@BuPulse.com", MAILBOXES)?.id).toBe("mbx_sales");
    expect(routeRecipient("billing@bupulse.com", MAILBOXES)?.id).toBe("mbx_other");
    expect(routeRecipient("someone@gmail.com", MAILBOXES)).toBeNull();
    expect(routeRecipient("x@mail.bupulse.com", MAILBOXES)).toBeNull();
    expect(routeRecipient("garbage", MAILBOXES)).toBeNull();
  });
  it("routes nothing when there is no catch-all", () => {
    expect(routeRecipient("billing@bupulse.com", MAILBOXES.slice(0, 2))).toBeNull();
  });
  it("parses typed address lists", () => {
    const { list, invalid } = parseAddressList('Ana <ana@x.rw>, b@y.co; "Doe, John" <j@z.com>, oops, b@y.co');
    expect(list).toEqual([{ name: "Ana", address: "ana@x.rw" }, { name: "", address: "b@y.co" }, { name: "Doe, John", address: "j@z.com" }]);
    expect(invalid).toEqual(["oops"]);
    expect(baseAddress("a+b+c@x.rw")).toBe("a@x.rw");
  });
  it("formats header addresses", () => {
    expect(formatAddress({ name: "Ana", address: "a@x.rw" })).toBe("Ana <a@x.rw>");
    expect(formatAddress({ name: "Doe, J.", address: "a@x.rw" })).toBe('"Doe, J." <a@x.rw>');
    expect(formatAddress({ name: "", address: "a@x.rw" })).toBe("a@x.rw");
    expect(formatAddress({ name: 'Evil"\r\nBcc: x', address: "a@x.rw" })).not.toMatch(/[\r\n]/);
  });
});

describe("threading", () => {
  it("normalises subjects", () => {
    expect(subjectKey("Re: Fwd: RE:  Invoice 12 ")).toBe("invoice 12");
    expect(subjectKey("AW: [BuPulse] Hello")).toBe("[bupulse] hello");
    expect(subjectKey("")).toBe("");
  });
  it("reads message ids", () => {
    expect(cleanMessageId("<abc@x.rw>")).toBe("abc@x.rw");
    expect(messageIdList("<a@x> <b@y>\r\n <a@x>")).toEqual(["a@x", "b@y"]);
    expect(messageIdList("plain@id")).toEqual(["plain@id"]);
  });
  const now = new Date("2026-11-23T10:00:00Z");
  const candidates = [
    { id: "t1", subjectKey: "invoice 12", lastMessageAt: new Date("2026-11-20T10:00:00Z"), participants: ["ana@x.rw"] },
    { id: "t2", subjectKey: "invoice 12", lastMessageAt: new Date("2026-09-01T10:00:00Z"), participants: ["bob@y.co"] },
  ];
  it("prefers header matches", () => {
    expect(pickThread({ headerMatches: ["t9"], subjectKey: "x", date: now, participants: [], candidates })).toBe("t9");
  });
  it("joins by subject only with a shared person inside the window", () => {
    expect(pickThread({ headerMatches: [], subjectKey: "invoice 12", date: now, participants: ["ANA@x.rw"], candidates })).toBe("t1");
    expect(pickThread({ headerMatches: [], subjectKey: "invoice 12", date: now, participants: ["bob@y.co"], candidates })).toBeNull();
    expect(pickThread({ headerMatches: [], subjectKey: "invoice 12", date: now, participants: ["eve@z.co"], candidates })).toBeNull();
    expect(pickThread({ headerMatches: [], subjectKey: "", date: now, participants: ["ana@x.rw"], candidates: [{ ...candidates[0], subjectKey: "" }] })).toBeNull();
  });
  it("builds reply headers and subjects", () => {
    expect(replyReferences({ messageId: "c@x", references: ["a@x", "b@x"] })).toEqual(["a@x", "b@x", "c@x"]);
    expect(replySubject("Re: hi")).toBe("Re: hi");
    expect(replySubject("hi")).toBe("Re: hi");
    expect(forwardSubject("Fw: hi")).toBe("Fw: hi");
    expect(forwardSubject("hi")).toBe("Fwd: hi");
  });
});

describe("inbound signature", () => {
  const secret = "test-secret-0123456789abcdef";
  const body = new TextEncoder().encode("From: a@x.rw\r\n\r\nhello");
  it("accepts a fresh signature for the same recipient and body", async () => {
    const header = await signInbound(secret, "cyusa@bupulse.com", body, 1_000_000);
    expect(await verifyInbound({ secret, header, recipient: "CYUSA@bupulse.com", body, nowSeconds: 1_000_100 })).toEqual({ ok: true });
  });
  it("refuses a changed body, recipient, stale time, wrong secret, missing header", async () => {
    const header = await signInbound(secret, "cyusa@bupulse.com", body, 1_000_000);
    expect(await verifyInbound({ secret, header, recipient: "cyusa@bupulse.com", body: new TextEncoder().encode("x"), nowSeconds: 1_000_000 })).toEqual({ ok: false, reason: "mismatch" });
    expect(await verifyInbound({ secret, header, recipient: "sales@bupulse.com", body, nowSeconds: 1_000_000 })).toEqual({ ok: false, reason: "mismatch" });
    expect(await verifyInbound({ secret, header, recipient: "cyusa@bupulse.com", body, nowSeconds: 1_000_000 + 301 })).toEqual({ ok: false, reason: "stale" });
    expect(await verifyInbound({ secret: "another-secret-0123456789", header, recipient: "cyusa@bupulse.com", body, nowSeconds: 1_000_000 })).toEqual({ ok: false, reason: "mismatch" });
    expect(await verifyInbound({ secret, header: null, recipient: "cyusa@bupulse.com", body })).toEqual({ ok: false, reason: "missing" });
    expect(await verifyInbound({ secret, header: "t=1,v1=zz", recipient: "cyusa@bupulse.com", body })).toEqual({ ok: false, reason: "malformed" });
    expect(await verifyInbound({ secret: "short", header, recipient: "cyusa@bupulse.com", body })).toEqual({ ok: false, reason: "no_secret" });
  });
});

const RAW = [
  "Authentication-Results: mx.cloudflare.net; spf=pass smtp.mailfrom=example.rw; dkim=pass header.d=example.rw; dmarc=pass",
  "From: \"Example Bank\" <notices@example.rw>",
  "To: Cyusa <cyusa@bupulse.com>, sales@bupulse.com",
  "Cc: =?UTF-8?B?QW7DoQ==?= <ana@example.rw>",
  "Subject: =?UTF-8?Q?Re:_Your_account_=E2=80=94_cards?=",
  "Date: Mon, 23 Nov 2026 08:00:00 +0200",
  "Message-ID: <msg-2@example.rw>",
  "In-Reply-To: <msg-1@bupulse.com>",
  "References: <msg-0@example.rw> <msg-1@bupulse.com>",
  "MIME-Version: 1.0",
  "Content-Type: multipart/mixed; boundary=\"b1\"",
  "",
  "--b1",
  "Content-Type: multipart/alternative; boundary=\"b2\"",
  "",
  "--b2",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Hello Cyusa,",
  "Your cards are ready.",
  "",
  "On Sun, 22 Nov 2026 Cyusa wrote:",
  "> old text",
  "--b2",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<p>Hello Cyusa,</p><p>Your cards are ready.</p>",
  "--b2--",
  "--b1",
  "Content-Type: application/pdf; name=\"form.pdf\"",
  "Content-Disposition: attachment; filename=\"form.pdf\"",
  "Content-Transfer-Encoding: base64",
  "",
  "JVBERi0xLjQK",
  "--b1--",
  "",
].join("\r\n");

describe("parsing", () => {
  it("reads a multipart message", async () => {
    const m = await parseMime(RAW, new Date("2026-11-23T10:00:00Z"));
    expect(m.from).toEqual({ name: "Example Bank", address: "notices@example.rw" });
    expect(m.to.map((a) => a.address)).toEqual(["cyusa@bupulse.com", "sales@bupulse.com"]);
    expect(m.cc).toEqual([{ name: "Aná", address: "ana@example.rw" }]);
    expect(m.subject).toBe("Re: Your account — cards");
    expect(m.messageId).toBe("msg-2@example.rw");
    expect(m.inReplyTo).toBe("msg-1@bupulse.com");
    expect(m.references).toEqual(["msg-0@example.rw", "msg-1@bupulse.com"]);
    expect(m.date.toISOString()).toBe("2026-11-23T06:00:00.000Z");
    expect(m.snippet).toBe("Hello Cyusa, Your cards are ready.");
    expect(m.html).toContain("<p>Hello Cyusa,</p>");
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0]).toMatchObject({ filename: "form.pdf", contentType: "application/pdf", inline: false });
    expect(new TextDecoder().decode(m.attachments[0].content)).toBe("%PDF-1.4\n");
    expect(m.authResults).toBe("spf=pass dkim=pass dmarc=pass");
    expect(m.suspicious).toBe(false);
  });
  it("uses the received time for a future date and flags DMARC failures", async () => {
    const raw = "From: x@y.co\r\nTo: cyusa@bupulse.com\r\nDate: Mon, 1 Jan 2035 00:00:00 +0000\r\nAuthentication-Results: mx; dmarc=fail\r\nContent-Type: text/html\r\n\r\n<div>Hi&nbsp;<b>there</b> &amp; you</div>";
    const received = new Date("2026-11-23T10:00:00Z");
    const m = await parseMime(raw, received);
    expect(m.date).toEqual(received);
    expect(m.text).toBe("Hi there & you");
    expect(m.suspicious).toBe(true);
    expect(m.messageId).toBeNull();
  });
  it("turns HTML into text and makes snippets", () => {
    expect(htmlToText("<style>p{}</style><p>a</p><p>b&#33;</p><ul><li>x</li></ul>")).toBe("a\nb!\n• x");
    expect(makeSnippet("Thanks!\n\n> quoted\nmore", 160)).toBe("Thanks! more");
    expect(makeSnippet("a".repeat(200), 20)).toHaveLength(20);
    expect(authSummary(["mx; spf=pass dkim=none", "other; spf=fail dmarc=pass"])).toBe("spf=pass dkim=none dmarc=pass");
  });
});
