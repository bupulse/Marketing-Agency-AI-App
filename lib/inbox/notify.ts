import "server-only";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { pushToLeadWatchers } from "@/lib/push/service";
import { alertRecipients } from "@/lib/team/recipients";

// Tells the team about a conversation that needs a person (an automation's "Hand over to the team" or "Notify the
// team" step): an email to the owner and the admins who get lead alerts, and a phone/browser alert on their devices.
// Never throws: the conversation is in the inbox either way.

export function conversationUrl(conversationId: string): string {
  return `${publicSiteUrl()}/dashboard/inbox?c=${encodeURIComponent(conversationId)}`;
}

export async function notifyTeam(businessId: string, alert: { title: string; body: string; conversationId: string }): Promise<{ emailed: number; pushed: number }> {
  const url = conversationUrl(alert.conversationId);
  let emailed = 0;
  let pushed = 0;
  try {
    const to = await alertRecipients(businessId);
    const { html, text } = renderEmail({ heading: alert.title, intro: alert.body, button: { label: "Open the conversation", url } });
    const results = await Promise.all(to.map((address) => sendEmail({ to: address, subject: alert.title, html, text }).catch(() => false)));
    emailed = results.filter(Boolean).length;
  } catch (error) {
    console.error("[inbox.notify] email", error instanceof Error ? error.message : error);
  }
  try {
    pushed = await pushToLeadWatchers(businessId, { title: alert.title, body: alert.body.slice(0, 180), url: `/dashboard/inbox?c=${encodeURIComponent(alert.conversationId)}`, tag: `conv-${alert.conversationId}` });
  } catch (error) {
    console.error("[inbox.notify] push", error instanceof Error ? error.message : error);
  }
  return { emailed, pushed };
}
