import { describe, expect, it } from "vitest";
import {
  addDaysYmd,
  cleanInvoiceSettings,
  computeTotals,
  defaultPaymentInstructions,
  DEFAULT_INVOICE_SETTINGS,
  formatInvoiceNumber,
  imageDimensions,
  logoProblem,
  invoiceSettingsProblem,
  invoiceToday,
  isInvoiceNumber,
  isOverdue,
  moneyInput,
  parseMoney,
  reminderDueToday,
  validateDraft,
} from "@/lib/invoices/shared";
import { isReference } from "@/lib/billing/momo-shared";

// The invoice rules with no I/O (lib/invoices/shared.ts): numbers, totals, money input, dates, the editor's checks and
// the settings shape.

describe("numbers", () => {
  it("are BP-INV- and at least four digits, growing past 9999", () => {
    expect(formatInvoiceNumber(1)).toBe("BP-INV-0001");
    expect(formatInvoiceNumber(BigInt(42))).toBe("BP-INV-0042");
    expect(formatInvoiceNumber(12345)).toBe("BP-INV-12345");
    expect(() => formatInvoiceNumber(0)).toThrow();
    expect(isInvoiceNumber("BP-INV-0001")).toBe(true);
    expect(isInvoiceNumber("BP-INV-1")).toBe(false);
    expect(isInvoiceNumber("BP-7K3Q")).toBe(false);
  });

  it("an invoice number is a valid Mobile Money reference, next to the BP-XXXX ones", () => {
    expect(isReference("BP-INV-0001")).toBe(true);
    expect(isReference("BP-7K3Q")).toBe(true);
    expect(isReference("BP-INV-X1")).toBe(false);
  });
});

describe("totals", () => {
  const lines = [
    { description: "Business plan", quantity: 1, unitMinor: 35000 },
    { description: "Extra channel", quantity: 2, unitMinor: 2000 },
  ];
  it("sum quantity x unit price, with no tax line by default", () => {
    expect(computeTotals(lines, null)).toEqual({ subtotalMinor: 39000, taxMinor: 0, totalMinor: 39000 });
    expect(computeTotals(lines, 0)).toEqual({ subtotalMinor: 39000, taxMinor: 0, totalMinor: 39000 });
  });
  it("add VAT rounded to the smallest unit when a rate is set", () => {
    expect(computeTotals(lines, 18)).toEqual({ subtotalMinor: 39000, taxMinor: 7020, totalMinor: 46020 });
    // USD cents: 4950 x 18% = 891
    expect(computeTotals([{ description: "Pro", quantity: 1, unitMinor: 4950 }], 18)).toEqual({ subtotalMinor: 4950, taxMinor: 891, totalMinor: 5841 });
    expect(computeTotals([{ description: "x", quantity: 3, unitMinor: 333 }], 7.5).taxMinor).toBe(75);
  });
});

describe("money typed in the editor", () => {
  it("RWF has no decimals; USD takes up to two", () => {
    expect(parseMoney("15,000", "RWF")).toBe(15000);
    expect(parseMoney("15000.5", "RWF")).toBeNull();
    expect(parseMoney("49", "USD")).toBe(4900);
    expect(parseMoney("49.5", "USD")).toBe(4950);
    expect(parseMoney("49.505", "USD")).toBeNull();
    expect(parseMoney("-1", "USD")).toBeNull();
    expect(parseMoney("abc", "RWF")).toBeNull();
    expect(moneyInput(4950, "USD")).toBe("49.50");
    expect(moneyInput(15000, "RWF")).toBe("15000");
  });
});

describe("dates", () => {
  it("today is the Kigali calendar day (UTC+2)", () => {
    expect(invoiceToday(new Date("2026-10-13T21:30:00Z"))).toBe("2026-10-13");
    expect(invoiceToday(new Date("2026-10-13T22:30:00Z"))).toBe("2026-10-14");
    expect(addDaysYmd("2026-10-30", 3)).toBe("2026-11-02");
  });
  it("overdue once the due day has passed in Kigali; the reminder is due on the due day, once", () => {
    const inv = { status: "sent", dueDate: new Date("2026-10-16T00:00:00Z"), reminderSentAt: null };
    expect(isOverdue(inv, new Date("2026-10-16T20:00:00Z"))).toBe(false);
    expect(isOverdue(inv, new Date("2026-10-16T22:30:00Z"))).toBe(true);
    expect(isOverdue({ ...inv, status: "paid" }, new Date("2026-11-01T00:00:00Z"))).toBe(false);
    expect(reminderDueToday(inv, new Date("2026-10-15T10:00:00Z"))).toBe(false);
    expect(reminderDueToday(inv, new Date("2026-10-16T05:41:00Z"))).toBe(true);
    expect(reminderDueToday({ ...inv, reminderSentAt: new Date() }, new Date("2026-10-16T05:41:00Z"))).toBe(false);
  });
});

describe("editor validation", () => {
  const good = { lines: [{ description: "Business plan, monthly", quantity: 1, unitMinor: 35000 }], dueDate: "2026-10-16", notes: "  ", billingEmail: "" };

  it("accepts a good draft, trims notes to null and lower-cases the billing contact", () => {
    const r = validateDraft({ ...good, billingEmail: "Accounts@Shop.RW" }, "2026-10-13", 18);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.notes).toBeNull();
    expect(r.data.billingEmail).toBe("accounts@shop.rw");
    expect(r.totals.totalMinor).toBe(41300);
  });

  it("names the field of each problem", () => {
    const bad = (over: object) => {
      const r = validateDraft({ ...good, ...over }, "2026-10-13", null);
      return r.ok ? null : r.errors;
    };
    expect(bad({ lines: [] })).toEqual({ lines: "Add at least one line." });
    expect(bad({ lines: [{ description: "", quantity: 1, unitMinor: 1 }] })).toHaveProperty(["lines.0.description"]);
    expect(bad({ lines: [{ description: "x", quantity: 0, unitMinor: 1 }] })).toHaveProperty(["lines.0.quantity"]);
    expect(bad({ lines: [{ description: "x", quantity: 1.5, unitMinor: 1 }] })).toHaveProperty(["lines.0.quantity"]);
    expect(bad({ lines: [{ description: "x", quantity: 1, unitMinor: -5 }] })).toHaveProperty(["lines.0.unitMinor"]);
    expect(bad({ lines: Array.from({ length: 31 }, () => good.lines[0]) })).toHaveProperty("lines");
    expect(bad({ dueDate: "2026-02-30" })).toEqual({ dueDate: "Choose a due date." });
    expect(bad({ dueDate: "2026-10-12" })).toEqual({ dueDate: "The due date cannot be before the issue date." });
    expect(bad({ dueDate: "2027-10-14" })).toEqual({ dueDate: "The due date is at most a year after the issue date." });
    expect(bad({ billingEmail: "not an email" })).toHaveProperty("billingEmail");
    expect(bad({ notes: "x".repeat(1001) })).toHaveProperty("notes");
    expect(bad({ lines: [{ description: "x", quantity: 10_000, unitMinor: 1_000_000 }] })).toEqual({ lines: "The total is too large for one invoice." });
  });
});

describe("settings", () => {
  it("defaults to BuPulse with no tax, and reads a broken row as the defaults", () => {
    expect(cleanInvoiceSettings(null)).toEqual(DEFAULT_INVOICE_SETTINGS);
    expect(cleanInvoiceSettings({ businessName: "", accentColor: "red", vatRatePercent: "18", logoPath: "../etc/passwd", logoType: "image/png" })).toEqual(DEFAULT_INVOICE_SETTINGS);
    expect(cleanInvoiceSettings({ vatRatePercent: 18, accentColor: "#ff8800", logoPath: "settings/logo-1.png", logoType: "image/png" })).toMatchObject({ vatRatePercent: 18, accentColor: "#FF8800", logoPath: "settings/logo-1.png" });
  });

  it("refuses malformed values instead of truncating them", () => {
    const base = { ...DEFAULT_INVOICE_SETTINGS };
    expect(invoiceSettingsProblem(base)).toBeNull();
    expect(invoiceSettingsProblem({ ...base, businessName: " " })).toMatch(/required/);
    expect(invoiceSettingsProblem({ ...base, email: "nope" })).toMatch(/email/);
    expect(invoiceSettingsProblem({ ...base, website: "bupulse" })).toMatch(/website/);
    expect(invoiceSettingsProblem({ ...base, vatRatePercent: 0 })).toMatch(/VAT/);
    expect(invoiceSettingsProblem({ ...base, vatRatePercent: 101 })).toMatch(/VAT/);
    expect(invoiceSettingsProblem({ ...base, accentColor: "blue" })).toMatch(/colour/);
    expect(invoiceSettingsProblem({ ...base, tin: "12<script>" })).toMatch(/TIN/);
    expect(invoiceSettingsProblem({ ...base, footer: "x".repeat(301) })).toMatch(/footer/);
  });

  it("the payment text starts from the Mobile Money details", () => {
    expect(defaultPaymentInstructions({ merchantCode: "123456", momoNumber: "0788000000", airtelNumber: "", accountName: "BuPulse Ltd" })).toBe(
      "Pay by Mobile Money to MoMo Pay code 123456 or MTN MoMo 0788000000 (BuPulse Ltd), or online with the link below.",
    );
    expect(defaultPaymentInstructions({ merchantCode: "", momoNumber: "", airtelNumber: "", accountName: "" })).toMatch(/online/);
  });
});

describe("logo headers", () => {
  it("reads PNG and JPEG sizes without decoding, and refuses anything else", () => {
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
    expect(imageDimensions(png)).toEqual({ type: "image/png", width: 1, height: 1 });
    // SOI, an APP0 segment, then SOF0 with height 300 and width 640.
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x80, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(imageDimensions(jpeg)).toEqual({ type: "image/jpeg", width: 640, height: 300 });
    const bomb = Uint8Array.from(jpeg);
    bomb.set([0xff, 0xff, 0xff, 0xff], 13);
    expect(logoProblem(bomb)).toMatch(/at most 2000/);
    expect(imageDimensions(new TextEncoder().encode("<svg></svg>"))).toBeNull();
    expect(imageDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(logoProblem(png)).toBeNull();
  });
});
