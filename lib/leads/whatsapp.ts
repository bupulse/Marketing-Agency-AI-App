import "server-only";
import { recordServiceUse } from "@/lib/admin/usage-counter";
import { isServiceEnabled } from "@/lib/admin/switch";
import { logError } from "@/lib/errors";
import { normalizePhone } from "./normalize";

// Official WhatsApp alerts for new leads: a utility template message ("new_lead_alert") sent with the WhatsApp Cloud
// API (Meta Graph API) from BuPulse's WhatsApp business number to the owner's number. Built but OFF: it needs the
// WhatsApp service switched on in Admin -> Services (off by default) and WHATSAPP_CLOUD_TOKEN and
// WHATSAPP_PHONE_NUMBER_ID set. While either is missing nothing is sent and clients see no WhatsApp option.
// What the owner must do to switch it on, with the template's exact wording: docs/RELEASE_2.0.md.

const GRAPH = "https://graph.facebook.com/v21.0";
export const DEFAULT_TEMPLATE = "new_lead_alert";

/**
 * What one utility template message costs BuPulse, in USD, for the money report's estimate (lib/money/costs.ts).
 * CHECK META'S RATE CARD (developers.facebook.com/docs/whatsapp/pricing): the price depends on the recipient's
 * country and changes; this is a placeholder of the right order for Africa, not a quote.
 */
export const WHATSAPP_UTILITY_USD = 0.004;

export type WhatsappConfig = { token: string; phoneNumberId: string; template: string; language: string };

export function whatsappConfig(): WhatsappConfig | null {
  const token = process.env.WHATSAPP_CLOUD_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneNumberId || !/^\d{5,20}$/.test(phoneNumberId)) return null;
  return { token, phoneNumberId, template: process.env.WHATSAPP_ALERT_TEMPLATE?.trim() || DEFAULT_TEMPLATE, language: process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "en" };
}

/** True when clients may switch WhatsApp alerts on: the keys are set and the admin switched the service on. */
export async function whatsappAlertsAvailable(): Promise<boolean> {
  return whatsappConfig() !== null && (await isServiceEnabled("whatsapp"));
}

/** An international number ("+250 788 123 456" -> "250788123456"), or null. WhatsApp needs the country code. */
export function whatsappRecipient(phone: string | null | undefined): string | null {
  const normalized = normalizePhone(phone);
  return normalized?.startsWith("+") ? normalized.slice(1) : null;
}

/** Template parameters may not hold new lines, tabs or more than four spaces in a row. */
const param = (value: string, max: number) => {
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text || "-";
};

export type WhatsappLead = { id: string; name: string | null; email: string | null; phone: string | null; message: string | null; interest: string | null };

/**
 * The Cloud API request body for the template (docs/RELEASE_2.0.md has its wording):
 * body {{1}} business name, {{2}} who got in touch, {{3}} what they wrote; URL button suffix {{1}} the lead id.
 */
export function templateMessage(to: string, lead: WhatsappLead, businessName: string, config: Pick<WhatsappConfig, "template" | "language">) {
  const who = lead.name || lead.phone || lead.email || "A visitor";
  const said = lead.message || lead.interest || "(no message)";
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: config.template,
      language: { code: config.language },
      components: [
        { type: "body", parameters: [{ type: "text", text: param(businessName, 60) }, { type: "text", text: param(who, 60) }, { type: "text", text: param(said, 200) }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: lead.id }] },
      ],
    },
  };
}

/**
 * Sends the alert. Counts it (ServiceUsage "whatsapp", which the money report prices at WHATSAPP_UTILITY_USD) and
 * logs a failure; never throws. False when it was not sent (not available, no number, or Meta refused it).
 */
export async function sendWhatsappLeadAlert(args: { to: string | null | undefined; lead: WhatsappLead; businessName: string; businessId: string }): Promise<boolean> {
  const config = whatsappConfig();
  const to = whatsappRecipient(args.to);
  if (!config || !to || !(await isServiceEnabled("whatsapp"))) return false;
  try {
    const response = await fetch(`${GRAPH}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(templateMessage(to, args.lead, args.businessName, config)),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const detail = ((await response.json().catch(() => null)) as { error?: { message?: string; code?: number } } | null)?.error;
      throw new Error(`WhatsApp Cloud API returned ${response.status}${detail?.code ? ` (code ${detail.code})` : ""}: ${detail?.message ?? "no details"}`);
    }
    await recordServiceUse("whatsapp", true);
    return true;
  } catch (error) {
    await recordServiceUse("whatsapp", false);
    await logError(error, { source: "whatsapp.lead_alert", level: "warn", businessId: args.businessId });
    return false;
  }
}
