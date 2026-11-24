import { describe, expect, it } from "vitest";
import { quotePreview, replyOptions, type QuoteSource } from "@/lib/mail/compose-rules";
import {
  ATTACH_MAX_BYTES, ATTACH_MAX_FILES, attachmentProblem, forwardFilePlan, isDraftEmpty, quotaProblem, readDraftMeta, safeContentType, safeFilename,
} from "@/lib/mail/draft-rules";
import {
  departmentProblem, deptToken, fillFirstName, firstNameOf, greetingFor, hasFirstName, personalRecipients, splitTokens, type DepartmentGroup,
} from "@/lib/mail/personal";
import { suggest, type AddressBook } from "@/lib/mail/suggest";

const MB = 1024 * 1024;
const p = (name: string, address: string) => ({ name, address, firstName: firstNameOf(name, address) });
const sales: DepartmentGroup = { id: "dep_sales", name: "Sales", color: "#2f6bff", head: "Grace Uwimana", members: [p("Grace Uwimana", "grace@bupulse.com"), p("Eric Mugisha", "eric@bupulse.com"), p("Cyusa", "cyusa@bupulse.com")] };
const support: DepartmentGroup = { id: "dep_support", name: "Support", color: "#14a3a6", head: null, members: [p("Diane Ishimwe", "diane@bupulse.com"), p("Eric Mugisha", "eric@bupulse.com")] };

describe("{first_name}", () => {
  it("takes the first word of the name, else the address", () => {
    expect(firstNameOf("Grace Uwimana", "grace@bupulse.com")).toBe("Grace");
    expect(firstNameOf("", "jean.bosco@example.rw")).toBe("Jean");
    expect(firstNameOf(null, "ERIC+news@x.rw")).toBe("Eric");
    expect(firstNameOf("someone@x.rw", "someone@x.rw")).toBe("Someone");
  });
  it("fills every spelling, and escapes the name in HTML", () => {
    expect(fillFirstName("Hi {first_name}, {First_Name} {{first_name}}", "Ana")).toBe("Hi Ana, Ana Ana");
    expect(fillFirstName("<p>{first_name}</p>", "<b>Bo</b>", { html: true })).toBe("<p>&lt;b&gt;Bo&lt;/b&gt;</p>");
    expect(hasFirstName("Dear {first_name}")).toBe(true);
    expect(hasFirstName("Dear team")).toBe(false);
    expect(greetingFor("Grace")).toBe("Hello Grace,");
  });
});

describe("departments as recipients", () => {
  it("splits chips from typed addresses", () => {
    expect(splitTokens([deptToken("dep_sales"), "a@b.rw", deptToken("dep_sales"), " "])).toEqual({ addresses: ["a@b.rw"], departments: ["dep_sales"] });
  });
  it("one personal email per person, once each, never to the sender", () => {
    const r = personalRecipients(["dep_sales", "dep_support"], [{ name: "", address: "ERIC@bupulse.com" }, { name: "Jean Bosco", address: "jb@hub.rw" }], [sales, support], ["cyusa@bupulse.com"]);
    expect(r.map((x) => x.address)).toEqual(["grace@bupulse.com", "eric@bupulse.com", "diane@bupulse.com", "jb@hub.rw"]);
    expect(r.map((x) => x.firstName)).toEqual(["Grace", "Eric", "Diane", "Jean"]);
  });
  it("only departments this person may send to (Everyone only for admins)", () => {
    expect(departmentProblem(["dep_sales"], [sales])).toBeNull();
    expect(departmentProblem(["dep_support"], [sales])).toMatch(/may not send/);
    expect(departmentProblem(["everyone"], [sales])).toMatch(/owner and Mail admins/);
  });
});

describe("attachments", () => {
  it("20 MB in all and 20 files per email", () => {
    expect(attachmentProblem([], 5 * MB)).toBeNull();
    expect(attachmentProblem([15 * MB], 5 * MB)).toBeNull();
    expect(attachmentProblem([15 * MB], 5 * MB + 1)).toMatch(/up to 20\.0 MB/);
    expect(attachmentProblem([], ATTACH_MAX_BYTES + 1)).not.toBeNull();
    expect(attachmentProblem(Array(ATTACH_MAX_FILES).fill(1), 1)).toMatch(/At most 20 files/);
    expect(attachmentProblem([], 0)).toMatch(/empty/);
  });
  it("counts against the person's storage", () => {
    expect(quotaProblem(200 * MB, 250, 40 * MB)).toBeNull();
    expect(quotaProblem(240 * MB, 250, 20 * MB)).toMatch(/storage is full/);
  });
  it("cleans names and types", () => {
    expect(safeFilename("a\r\nb/c.pdf")).toBe("a b c.pdf");
    expect(safeContentType("application/pdf")).toBe("application/pdf");
    expect(safeContentType("text/html; charset=x<script>")).toBe("application/octet-stream");
  });
  it("forwarding keeps the original files unless removed; Reply takes them away", () => {
    const parent = [{ path: "att/x/1-a.pdf" }, { path: "att/x/2-b.png" }];
    expect(forwardFilePlan(parent, [], "forward", []).add).toHaveLength(2);
    expect(forwardFilePlan(parent, [{ id: "d1", path: "att/x/1-a.pdf" }], "forward", ["att/x/2-b.png"]).add).toEqual([]);
    expect(forwardFilePlan(parent, [{ id: "d1", path: "att/x/1-a.pdf" }, { id: "d2", path: "out/d/own.pdf" }], "reply", []).remove).toEqual(["d1"]);
  });
});

describe("drafts", () => {
  const blank = { to: [], cc: [], bcc: [], subject: "", bodyText: "", attachments: [] };
  it("an untouched composer is empty; words, recipients or own files are not", () => {
    expect(isDraftEmpty(blank)).toBe(true);
    expect(isDraftEmpty({ ...blank, bodyText: "  ​ " })).toBe(true);
    expect(isDraftEmpty({ ...blank, bodyText: "Hello" })).toBe(false);
    expect(isDraftEmpty({ ...blank, to: ["a@b.rw"] })).toBe(false);
    expect(isDraftEmpty({ ...blank, attachments: [{ id: "1", filename: "a.pdf", size: 1, contentType: "application/pdf" }] })).toBe(false);
    expect(isDraftEmpty({ ...blank, attachments: [{ id: "1", filename: "a.pdf", size: 1, contentType: "application/pdf", forwarded: true }] })).toBe(true);
  });
  it("a reply or forward with what it was opened with is still empty", () => {
    expect(isDraftEmpty({ ...blank, to: ["a@b.rw"], subject: "Re: x", initial: { to: ["a@b.rw"], subject: "Re: x" } })).toBe(true);
    expect(isDraftEmpty({ ...blank, to: ["a@b.rw", "c@d.rw"], subject: "Re: x", initial: { to: ["a@b.rw"], subject: "Re: x" } })).toBe(false);
  });
  it("reads a stored draft safely", () => {
    expect(readDraftMeta(null)).toBeNull();
    expect(readDraftMeta([])).toBeNull();
    const m = readDraftMeta({ to: ["dept:dep_sales", 5, "a@b.rw"], body: "<p>x</p>", mode: "bogus", parentId: "" });
    expect(m).toMatchObject({ to: ["dept:dep_sales", "a@b.rw"], cc: [], body: "<p>x</p>", mode: "new", parentId: null, dropped: [] });
  });
});

describe("reply switch and quote", () => {
  const m: QuoteSource = {
    fromName: "Jean Bosco", fromAddress: "jb@hub.rw", replyTo: null, direction: "in", subject: "Workshops",
    to: [{ name: "", address: "cyusa@bupulse.com" }, { name: "Grace", address: "grace@bupulse.com" }], cc: [{ name: "Patrick", address: "p@hub.rw" }],
    dateLong: "Mon, 23 Nov 2026, 09:40", text: "The board agreed.",
  };
  it("forward shows the Forwarded message block, replies the On … wrote: line", () => {
    expect(quotePreview(m, "forward").head.split("\n")[0]).toBe("---------- Forwarded message ---------");
    expect(quotePreview(m, "forward").head).toContain("From: Jean Bosco <jb@hub.rw>");
    expect(quotePreview(m, "reply").head).toBe("On Mon, 23 Nov 2026, 09:40, Jean Bosco <jb@hub.rw> wrote:");
    expect(quotePreview(m, "all").head).not.toMatch(/Forwarded/);
  });
  it("gives To, Cc and subject for each mode", () => {
    const o = replyOptions(m, "cyusa@bupulse.com");
    expect(o.reply).toMatchObject({ to: ["jb@hub.rw"], cc: [], subject: "Re: Workshops" });
    expect(o.all).toMatchObject({ to: ["jb@hub.rw"], cc: ["grace@bupulse.com", "p@hub.rw"] });
    expect(o.forward).toMatchObject({ to: [], cc: [], subject: "Fwd: Workshops" });
  });
});

describe("address suggestions", () => {
  const book: AddressBook = {
    departments: [sales, support],
    people: [
      { name: "Grace Uwimana", address: "grace@bupulse.com", kind: "team" },
      { name: "Grace U", address: "grace@bupulse.com", kind: "recent" },
      { name: "Support", address: "support@bupulse.com", kind: "mailbox", note: "Shared mailbox" },
      { name: "Jean Bosco", address: "jb@hub.rw", kind: "recent" },
      { name: "Supplier Ltd", address: "orders@supplier.rw", kind: "recent" },
    ],
  };
  it("departments first, then people; a person shows once", () => {
    const r = suggest("sup", book, [], { departments: true });
    expect(r.departments.map((d) => d.id)).toEqual(["dep_support"]);
    expect(r.people.map((x) => x.address)).toEqual(["support@bupulse.com", "orders@supplier.rw"]);
    expect(suggest("gra", book, []).people).toEqual([book.people[0]]);
  });
  it("no departments in Cc, nothing already chosen, nothing for an empty box", () => {
    expect(suggest("sup", book, [], { departments: false }).departments).toEqual([]);
    expect(suggest("sup", book, [deptToken("dep_support"), "support@bupulse.com"]).departments).toEqual([]);
    expect(suggest("sup", book, ["support@bupulse.com"]).people.map((x) => x.address)).toEqual(["orders@supplier.rw"]);
    expect(suggest("  ", book, [])).toEqual({ departments: [], people: [] });
  });
  it("matches a word inside a name or the address", () => {
    expect(suggest("bosco", book, []).people.map((x) => x.address)).toEqual(["jb@hub.rw"]);
    expect(suggest("hub", book, []).people.map((x) => x.address)).toEqual(["jb@hub.rw"]);
  });
});
