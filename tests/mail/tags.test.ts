import { describe, expect, it } from "vitest";
import { isImportant, tagsFor, type TagInput } from "@/lib/mail/tags";

const base: TagInput = { fromAddress: "someone@example.rw", fromName: "", subject: "", text: "", mailboxAddress: "cyusa@bupulse.com", attachmentNames: [] };
const t = (over: Partial<TagInput>) => tagsFor({ ...base, ...over });

describe("tags", () => {
  it("knows banks by domain and words", () => {
    expect(t({ fromAddress: "notices@imbank.co.rw", subject: "Your account" })).toContain("bank");
    expect(t({ subject: "Your debit card is ready" })).toContain("bank");
  });
  it("finds invoices, receipts and payments", () => {
    expect(t({ subject: "Invoice INV-2041 for printer paper" })).toContain("invoices");
    expect(t({ subject: "Order", attachmentNames: ["facture-12.pdf"] })).toContain("invoices");
    expect(t({ subject: "Payment received: 59,000 RWF" })).toEqual(["receipts"]);
    expect(t({ fromAddress: "merchants@irembopay.rw", subject: "Onboarding" })).toContain("payments");
  });
  it("leads on sales@, support on support@, partners by words", () => {
    expect(t({ mailboxAddress: "sales@bupulse.com", subject: "Hello" })).toEqual(["leads"]);
    expect(t({ subject: "How much is the standard plan?" })).toEqual(["leads"]);
    expect(t({ mailboxAddress: "support@bupulse.com", subject: "Hi" })).toEqual(["support"]);
    expect(t({ subject: "Partnership workshops in January" })).toEqual(["partners"]);
  });
  it("updates for newsletters and no-reply senders, nothing for a plain note", () => {
    expect(t({ fromAddress: "no-reply@example.com", subject: "Welcome" })).toEqual(["updates"]);
    expect(t({ subject: "Weekly update from the team" })).toEqual(["updates"]);
    expect(t({ subject: "Lunch tomorrow?" })).toEqual([]);
  });
  it("marks money and leads important, updates not", () => {
    expect(isImportant(base, ["bank"])).toBe(true);
    expect(isImportant(base, ["leads"])).toBe(true);
    expect(isImportant({ ...base, subject: "URGENT: sign today" }, [])).toBe(true);
    expect(isImportant({ ...base, subject: "urgent" }, ["updates"])).toBe(false);
    expect(isImportant(base, [])).toBe(false);
  });
});
