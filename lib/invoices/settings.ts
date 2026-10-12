import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { getMomoSettings } from "@/lib/billing/momo-settings";
import type { InvoiceLogo } from "./pdf";
import { cleanInvoiceSettings, defaultPaymentInstructions, INVOICE_SETTING_KEY, invoiceSettingsProblem, logoProblem, type InvoiceSettings } from "./shared";
import { getInvoiceObject, putInvoiceObject, removeInvoiceObject } from "./storage";

// The owner's invoice settings (Admin -> Invoices -> Settings), one AdminSetting row (key "invoice.settings"). Every
// change is audited with the stored values read inside the transaction.

export const LOGO_MAX_BYTES = 512 * 1024;

export async function getInvoiceSettings(): Promise<InvoiceSettings> {
  try {
    const row = await prisma.adminSetting.findUnique({ where: { key: INVOICE_SETTING_KEY } });
    return cleanInvoiceSettings(row?.value);
  } catch {
    return cleanInvoiceSettings(null);
  }
}

/** The payment text an invoice prints: the owner's own, or one built from where clients pay by Mobile Money. */
export async function paymentInstructionsFor(settings: InvoiceSettings) {
  const momo = await getMomoSettings();
  const details = { merchantCode: momo.merchantCode, momoNumber: momo.momoNumber, airtelNumber: momo.airtelNumber, accountName: momo.accountName };
  return { instructions: settings.paymentInstructions || defaultPaymentInstructions(details), details };
}

export type InvoiceSettingsInput = Partial<Omit<InvoiceSettings, "logoPath" | "logoType" | "vatRatePercent">> & { vatRatePercent?: string | number | null };

function parseRate(value: string | number | null | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const raw = String(value).replace(/[%\s]/g, "").replace(",", ".");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new AdminError("invalid", "The VAT rate is a number above 0 and at most 100, or empty for no tax.");
  return n;
}

async function write(ctx: AdminContext, change: (before: InvoiceSettings) => InvoiceSettings, action: string) {
  if (ctx.viaApi) throw new AdminError("forbidden", "Invoice settings are changed in the admin console only.");
  return prisma.$transaction(async (tx) => {
    const row = await tx.adminSetting.findUnique({ where: { key: INVOICE_SETTING_KEY } });
    const before = cleanInvoiceSettings(row?.value);
    const merged = change(before);
    const problem = invoiceSettingsProblem(merged);
    if (problem) throw new AdminError("invalid", problem);
    const after = cleanInvoiceSettings(merged);
    await tx.adminSetting.upsert({ where: { key: INVOICE_SETTING_KEY }, create: { key: INVOICE_SETTING_KEY, value: after as Prisma.InputJsonObject }, update: { value: after as Prisma.InputJsonObject } });
    await writeAudit(tx, ctx, action, `setting:${INVOICE_SETTING_KEY}`, before, after);
    return { before, after };
  });
}

/** Saves the texts, the colour and the VAT rate. Refused (not truncated) when something is malformed. */
export async function saveInvoiceSettings(ctx: AdminContext, input: InvoiceSettingsInput): Promise<InvoiceSettings> {
  const rate = parseRate(input.vatRatePercent);
  const { after } = await write(
    ctx,
    (before) => {
      const next: InvoiceSettings = { ...before };
      for (const [k, v] of Object.entries(input)) {
        if (k === "vatRatePercent" || v === undefined) continue;
        if (k in next && typeof v === "string") (next as Record<string, unknown>)[k] = v.trim();
      }
      if (rate !== undefined) next.vatRatePercent = rate;
      if (next.accentColor) next.accentColor = next.accentColor.toUpperCase();
      return next;
    },
    "set_invoice_settings",
  );
  return after;
}

/** PNG or JPEG, told apart by the file's first bytes (never by its name or the browser's word for it). */
export function logoTypeOf(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

/** Uploads a new invoice logo (PNG or JPEG, at most 512 KB) to the private bucket and points the settings at it. */
export async function uploadInvoiceLogo(ctx: AdminContext, bytes: Uint8Array): Promise<InvoiceSettings> {
  if (ctx.viaApi) throw new AdminError("forbidden", "Invoice settings are changed in the admin console only.");
  if (bytes.length === 0) throw new AdminError("invalid", "Choose a logo file.");
  if (bytes.length > LOGO_MAX_BYTES) throw new AdminError("invalid", "The logo is at most 512 KB. Export a smaller PNG or JPEG.");
  // Checked from the header before anything is decoded or stored: PNG or JPEG only (no SVG), at most 2000 x 2000 pixels.
  const problem = logoProblem(bytes);
  if (problem) throw new AdminError("invalid", problem);
  const type = logoTypeOf(bytes);
  if (!type) throw new AdminError("invalid", "The logo must be a PNG or JPEG image.");
  const path = `settings/logo-${globalThis.crypto.randomUUID()}.${type === "image/png" ? "png" : "jpg"}`;
  await putInvoiceObject(path, bytes, type);
  const { before, after } = await write(ctx, (b) => ({ ...b, logoPath: path, logoType: type }), "set_invoice_logo");
  if (before.logoPath && before.logoPath !== after.logoPath) await removeInvoiceObject(before.logoPath);
  return after;
}

export async function removeInvoiceLogo(ctx: AdminContext): Promise<InvoiceSettings> {
  const { before, after } = await write(ctx, (b) => ({ ...b, logoPath: "", logoType: "" }), "set_invoice_logo");
  if (before.logoPath) await removeInvoiceObject(before.logoPath);
  return after;
}

/** The logo's bytes for a PDF, or null (no logo, or Storage unreachable: the invoice is drawn without it). */
export async function loadInvoiceLogo(path: string | null | undefined, type: string | null | undefined): Promise<InvoiceLogo | null> {
  if (!path || (type !== "image/png" && type !== "image/jpeg")) return null;
  const bytes = await getInvoiceObject(path);
  return bytes ? { bytes, type } : null;
}

/** The logo as a data: URL for the admin previews (at most 512 KB, so it inlines fine), or null. */
export async function logoDataUrl(path: string | null | undefined, type: string | null | undefined): Promise<string | null> {
  const logo = await loadInvoiceLogo(path, type);
  if (!logo) return null;
  let binary = "";
  for (let i = 0; i < logo.bytes.length; i += 0x8000) binary += String.fromCharCode(...logo.bytes.subarray(i, i + 0x8000));
  return `data:${logo.type};base64,${btoa(binary)}`;
}
