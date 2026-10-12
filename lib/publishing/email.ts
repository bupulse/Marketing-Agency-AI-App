import "server-only";
import { isServiceEnabled } from "@/lib/admin/switch";
import { recordServiceUse } from "@/lib/admin/usage-counter";

/** `attachments` are base64 file bodies (Resend's shape), used for the demo calendar invites. */
export type Email = { to: string; subject: string; html: string; text: string; attachments?: { filename: string; content: string }[] };

const DEFAULT_FROM = "BuPulse <register@bupulse.com>";

/**
 * Sends one email through Resend (docs/EMAIL_SETUP.md). Returns false, never throws, so a mail problem
 * cannot break publishing. Without RESEND_API_KEY it logs and returns false (local development).
 */
export async function sendEmail(email: Email): Promise<boolean> {
  // Switched off in the admin console: nothing is sent and false comes back. This is NOT a failure to retry: callers that
  // would count an attempt check isServiceEnabled("resend") first and wait instead (reminder posts are not claimed, price
  // notices and the lead digest do not start). Leads stay saved and show in the dashboard and the next digest.
  if (!(await isServiceEnabled("resend"))) {
    console.warn("[publishing.email] Resend is switched off in the admin console; email not sent:", email.subject);
    return false;
  }
  const sent = await deliver(email);
  if (process.env.RESEND_API_KEY) await recordServiceUse("resend", sent);
  return sent;
}

async function deliver(email: Email): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("[publishing.email] RESEND_API_KEY is not set; email not sent:", email.subject);
    return false;
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || DEFAULT_FROM,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(email.attachments?.length ? { attachments: email.attachments } : {}),
      }),
    });
    if (!response.ok) {
      console.error("[publishing.email] Resend refused the email:", response.status, (await response.text()).slice(0, 300));
      return false;
    }
    return true;
  } catch (error) {
    console.error("[publishing.email] Resend request failed:", error instanceof Error ? error.message : error);
    return false;
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** One email layout for every publishing email: heading, paragraphs, optional extras and a button. */
export function renderEmail(args: {
  heading: string;
  intro: string;
  blocks?: { label: string; value: string }[];
  links?: { label: string; url: string }[];
  button?: { label: string; url: string };
  footer?: string;
}): { html: string; text: string } {
  const { heading, intro, blocks = [], links = [], button, footer } = args;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d1d1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:20px;padding:28px">
<tr><td>
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25">${escapeHtml(heading)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#3a3a3d">${escapeHtml(intro)}</p>
${blocks
  .map(
    (b) =>
      `<p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6e6e73">${escapeHtml(b.label)}</p><div style="margin:0 0 18px;padding:14px 16px;background:#f5f5f7;border-radius:12px;font-size:15px;line-height:1.5;white-space:pre-wrap;word-break:break-word">${escapeHtml(b.value)}</div>`,
  )
  .join("")}
${links.length ? `<p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6e6e73">Images</p><p style="margin:0 0 18px;font-size:15px;line-height:1.7">${links.map((l) => `<a href="${escapeHtml(l.url)}" style="color:#2f6bff">${escapeHtml(l.label)}</a>`).join("<br>")}</p>` : ""}
${button ? `<p style="margin:8px 0 4px"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#2f6bff;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 22px;border-radius:24px">${escapeHtml(button.label)}</a></p>` : ""}
${footer ? `<p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6e6e73">${escapeHtml(footer)}</p>` : ""}
</td></tr></table></td></tr></table></body></html>`;
  const text = [
    heading,
    "",
    intro,
    ...blocks.flatMap((b) => ["", `${b.label.toUpperCase()}`, b.value]),
    ...(links.length ? ["", "IMAGES", ...links.map((l) => `${l.label}: ${l.url}`)] : []),
    ...(button ? ["", `${button.label}: ${button.url}`] : []),
    ...(footer ? ["", footer] : []),
  ].join("\n");
  return { html, text };
}
