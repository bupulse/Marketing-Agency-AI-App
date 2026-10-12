import "server-only";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { formatInvoiceMoney, longInvoiceDate } from "./shared";

// The invoice emails. Short HTML (renderEmail escapes every value) with the PDF attached; sendEmail never throws and
// says whether the mail went out, so the callers decide what a failed send means.

type InvoiceMail = { number: string; totalMinor: number; currency: string; dueDate: Date | string; sellerName: string; billToName: string; payUrl: string; recipientName?: string | null };

const first = (name: string | null | undefined) => (name ? `Hi ${name.split(/\s+/)[0]}, ` : "");
/** Base64 of the PDF for Resend's attachments, without Buffer (Workers have it with nodejs_compat, but this is plain). */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The invoice itself: amount, due date and a Pay online button, the PDF attached. One email per address. */
export async function sendInvoiceEmail(to: string[], mail: InvoiceMail, pdf: Uint8Array): Promise<{ sent: number; failed: number }> {
  const amount = formatInvoiceMoney(mail.totalMinor, mail.currency);
  const due = longInvoiceDate(mail.dueDate);
  const { html, text } = renderEmail({
    heading: `Invoice ${mail.number}: ${amount}`,
    intro: `${first(mail.recipientName)}here is your invoice from ${mail.sellerName} for ${mail.billToName}. The PDF is attached. You can pay online by Mobile Money or card; use ${mail.number} as the payment reference.`,
    blocks: [
      { label: "Amount due", value: amount },
      { label: "Due date", value: due },
      { label: "Reference", value: mail.number },
    ],
    button: { label: "Pay online", url: mail.payUrl },
    footer: "Questions about this invoice? Reply to this email and we will help you.",
  });
  const attachments = [{ filename: `${mail.number}.pdf`, content: toBase64(pdf) }];
  const results = await Promise.all(to.map((address) => sendEmail({ to: address, subject: `Invoice ${mail.number} from ${mail.sellerName}: ${amount} due ${due}`, html, text, attachments })));
  const sent = results.filter(Boolean).length;
  return { sent, failed: results.length - sent };
}

/** On the due date: a short reminder with the same PDF. */
export async function sendInvoiceReminderEmail(to: string[], mail: InvoiceMail, pdf: Uint8Array | null): Promise<{ sent: number; failed: number }> {
  const amount = formatInvoiceMoney(mail.totalMinor, mail.currency);
  const due = longInvoiceDate(mail.dueDate);
  const { html, text } = renderEmail({
    heading: `Invoice ${mail.number} is due`,
    intro: `${first(mail.recipientName)}a reminder that invoice ${mail.number} (${amount}) for ${mail.billToName} is due on ${due}. If you have already paid, thank you: you can ignore this email.`,
    blocks: [
      { label: "Amount due", value: amount },
      { label: "Reference", value: mail.number },
    ],
    button: { label: "Pay online", url: mail.payUrl },
    footer: "Your account and everything you made stay saved. Paying switches your plan on as soon as the payment is confirmed.",
  });
  const attachments = pdf ? [{ filename: `${mail.number}.pdf`, content: toBase64(pdf) }] : undefined;
  const results = await Promise.all(to.map((address) => sendEmail({ to: address, subject: `Reminder: invoice ${mail.number} (${amount}) is due ${due}`, html, text, attachments })));
  const sent = results.filter(Boolean).length;
  return { sent, failed: results.length - sent };
}
