import "server-only";
import { adminEmails } from "@/lib/admin/auth";
import { siteUrl } from "@/lib/auth/site-url";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { formatMomoAmount, GRACE_DAYS, whatsappText, type MomoPayDetails } from "./momo-shared";

// Every email of the Mobile Money flow. All of them go through sendEmail (Resend, kill switch respected) and return
// whether the mail went out; nothing here throws, so a mail problem never stops a payment being recorded.

const longDate = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const billingUrl = () => `${siteUrl()}/dashboard/billing`;
const first = (name: string | null | undefined) => (name ? `Hi ${name.split(/\s+/)[0]}, ` : "");

/** "MoMo Pay 123456 · 078 123 4567 (Aline U.) · Airtel 073 …" as one line for emails. */
export function payDetailsLine(d: MomoPayDetails): string {
  return [
    d.merchantCode ? `MoMo Pay code ${d.merchantCode}` : null,
    d.momoNumber ? `MTN number ${d.momoNumber}` : null,
    d.airtelNumber ? `Airtel number ${d.airtelNumber}` : null,
    d.accountName ? `(${d.accountName})` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export type ClientRecipient = { email: string; name: string | null };

/** The owner's alert that a client has paid and typed a transaction id. One email per address in ADMIN_EMAILS. */
export async function sendPaymentToCheckEmail(p: { reference: string; amountMinor: number; currency: string; planName: string; interval: string; transactionId: string; payerPhone: string; network: string; company: string; email: string }): Promise<boolean> {
  const admins = adminEmails();
  if (admins.length === 0) return false;
  const { html, text } = renderEmail({
    heading: "New MoMo payment to check",
    intro: `${p.company} (${p.email}) says they paid ${formatMomoAmount(p.amountMinor, p.currency)} for the ${p.planName} plan (${p.interval === "YEAR" ? "yearly" : "monthly"}). Check your Mobile Money messages for the reference, then confirm or reject it in the admin console.`,
    blocks: [
      { label: "Reference", value: p.reference },
      { label: "Transaction id", value: p.transactionId },
      { label: "Paid from", value: `${p.payerPhone} (${p.network})` },
    ],
    button: { label: "Open Payments", url: `${siteUrl()}/admin/payments` },
  });
  const results = await Promise.all(admins.map((to) => sendEmail({ to, subject: `New MoMo payment to check: ${p.reference} · ${formatMomoAmount(p.amountMinor, p.currency)}`, html, text })));
  return results.some(Boolean);
}

/** The client's confirmation: the plan is on, until when. */
export async function sendPlanActiveEmail(to: ClientRecipient, p: { planName: string; interval: string; amountMinor: number; currency: string; reference: string; periodEnd: Date }): Promise<boolean> {
  const { html, text } = renderEmail({
    heading: `Your ${p.planName} plan is active`,
    intro: `${first(to.name)}we have received your Mobile Money payment of ${formatMomoAmount(p.amountMinor, p.currency)} (reference ${p.reference}). Your ${p.planName} plan is active until ${longDate(p.periodEnd)}.`,
    blocks: [
      { label: "Plan", value: `${p.planName}, ${p.interval === "YEAR" ? "yearly" : "monthly"}` },
      { label: "Paid until", value: longDate(p.periodEnd) },
    ],
    button: { label: "Open BuPulse", url: `${siteUrl()}/dashboard` },
    footer: `We will remind you by email a few days before ${longDate(p.periodEnd)}. Nothing renews by itself and nothing is ever deleted.`,
  });
  return sendEmail({ to: to.email, subject: `Your BuPulse ${p.planName} plan is active`, html, text });
}

/** The client's rejection notice, with the owner's reason and how to try again. */
export async function sendPaymentRejectedEmail(to: ClientRecipient, p: { planName: string; amountMinor: number; currency: string; reference: string; reason: string }): Promise<boolean> {
  const { html, text } = renderEmail({
    heading: "We could not match your payment",
    intro: `${first(to.name)}we could not confirm the Mobile Money payment of ${formatMomoAmount(p.amountMinor, p.currency)} for the ${p.planName} plan (reference ${p.reference}).`,
    blocks: [{ label: "Reason", value: p.reason }],
    button: { label: "Try again", url: billingUrl() },
    footer: "If you did pay, reply to this email with the transaction id and the phone number you paid from and we will sort it out.",
  });
  return sendEmail({ to: to.email, subject: `Your BuPulse payment ${p.reference} needs another look`, html, text });
}

export type ReminderInput = {
  planName: string;
  interval: string;
  amountMinor: number;
  currency: string;
  periodEnd: Date;
  details: MomoPayDetails;
};

/** 5 days and 1 day before the paid period ends: amount, how to pay, and a WhatsApp-ready text. */
export async function sendRenewalReminderEmail(to: ClientRecipient, kind: "5d" | "1d", p: ReminderInput): Promise<boolean> {
  const when = kind === "5d" ? `in 5 days, on ${longDate(p.periodEnd)}` : `on ${longDate(p.periodEnd)}`;
  const { html, text } = renderEmail({
    heading: kind === "5d" ? `Your ${p.planName} plan ends in 5 days` : `Your ${p.planName} plan ends ${kind === "1d" ? "tomorrow" : "soon"}`,
    intro: `${first(to.name)}your ${p.planName} plan (${p.interval === "YEAR" ? "yearly" : "monthly"}) ends ${when}. Pay ${formatMomoAmount(p.amountMinor, p.currency)} by Mobile Money to keep creating. After ${longDate(p.periodEnd)} you have ${GRACE_DAYS} days of grace, then the account becomes read-only until you pay. Nothing is deleted.`,
    blocks: [
      { label: "Amount", value: formatMomoAmount(p.amountMinor, p.currency) },
      { label: "Where to pay", value: payDetailsLine(p.details) || "See the Billing page" },
      { label: "How", value: "Open Billing, choose Pay by Mobile Money, pay with the reference shown, then tap I've paid. Your plan is extended within minutes." },
      { label: "Need help? Copy this into WhatsApp", value: whatsappText({ planName: p.planName, amountMinor: p.amountMinor, currency: p.currency, email: to.email, periodEnd: longDate(p.periodEnd) }) },
    ],
    button: { label: "Pay now", url: billingUrl() },
  });
  return sendEmail({ to: to.email, subject: `Your BuPulse ${p.planName} plan ends ${kind === "5d" ? "in 5 days" : "tomorrow"}`, html, text });
}

/** The grace period is over: the account is read-only until the client pays. */
export async function sendPlanPausedEmail(to: ClientRecipient, p: ReminderInput): Promise<boolean> {
  const { html, text } = renderEmail({
    heading: `Your ${p.planName} plan is paused`,
    intro: `${first(to.name)}your ${p.planName} plan ended on ${longDate(p.periodEnd)} and we have not received a payment. Everything you made is safe and nothing is deleted; new content is paused until you pay ${formatMomoAmount(p.amountMinor, p.currency)} by Mobile Money.`,
    blocks: [
      { label: "Where to pay", value: payDetailsLine(p.details) || "See the Billing page" },
      { label: "Need help? Copy this into WhatsApp", value: whatsappText({ planName: p.planName, amountMinor: p.amountMinor, currency: p.currency, email: to.email, periodEnd: longDate(p.periodEnd) }) },
    ],
    button: { label: "Pay and continue", url: billingUrl() },
  });
  return sendEmail({ to: to.email, subject: `Your BuPulse ${p.planName} plan is paused`, html, text });
}
