import { describe, expect, it } from "vitest";
import { contactSchema } from "@/lib/contact";

const valid = { kind: "contact", name: "Ana", email: " Ana@Example.com ", message: "Hello, I have a question." };

describe("contactSchema", () => {
  it("normalises the email and drops empty optional fields", () => {
    const result = contactSchema.parse({ ...valid, phone: "", industry: "" });
    expect(result.email).toBe("ana@example.com");
    expect(result.phone).toBeUndefined();
  });

  it("rejects empty and invalid input with friendly messages", () => {
    const result = contactSchema.safeParse({ kind: "contact", name: "", email: "nope", message: "short" });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((i) => i.message) ?? [];
    expect(messages).toContain("Please tell us your name.");
    expect(messages).toContain("That email address does not look right.");
  });

  it("only accepts known kinds", () => {
    expect(contactSchema.safeParse({ ...valid, kind: "meta_data_deletion" }).success).toBe(false);
  });
});
