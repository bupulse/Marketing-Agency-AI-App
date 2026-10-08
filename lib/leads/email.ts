import "server-only";
import { renderEmail } from "@/lib/publishing/email";
import { siteUrl } from "@/lib/auth/site-url";
import { sourceLabel } from "./filters";

export type EmailLead = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  interest: string | null;
  message: string | null;
  source: string;
  pageUrl: string | null;
  createdAt: Date;
};
export type TranscriptLine = { role: string; content: string };

const oneLine = (value: string) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** How a lead is named in subjects and lists: name, else email, else phone, else "a visitor". */
export function leadLabel(lead: Pick<EmailLead, "name" | "email" | "phone">): string {
  return clip(oneLine(lead.name || lead.email || lead.phone || "a visitor"), 80);
}

export function leadsUrl(leadId?: string): string {
  return `${siteUrl()}/dashboard/leads${leadId ? `?lead=${encodeURIComponent(leadId)}` : ""}`;
}

function contactLines(lead: EmailLead): string {
  return (
    [lead.name && `Name: ${lead.name}`, lead.email && `Email: ${lead.email}`, lead.phone && `Phone: ${lead.phone}`].filter(Boolean).join("\n") ||
    "The visitor did not leave contact details."
  );
}

/** The instant email to the owner for a new lead. */
export function renderInstantLeadEmail(args: { lead: EmailLead; businessName: string; transcript: TranscriptLine[] }) {
  const { lead, businessName, transcript } = args;
  const blocks = [{ label: "Contact", value: contactLines(lead) }];
  const interest = lead.interest || lead.message;
  if (interest) blocks.push({ label: lead.interest ? "Interested in" : "Message", value: clip(interest, 600) });
  if (transcript.length) {
    blocks.push({
      label: "Last messages",
      value: transcript
        .slice(-6)
        .map((m) => `${m.role === "visitor" ? "Visitor" : "Chat"}: ${clip(oneLine(m.content), 300)}`)
        .join("\n"),
    });
  }
  if (lead.pageUrl) blocks.push({ label: "Page", value: lead.pageUrl });
  const mail = renderEmail({
    heading: `New lead from ${sourceLabel(lead.source).toLowerCase()}`,
    intro: `${leadLabel(lead)} got in touch with ${businessName}. Reply quickly: the first business to answer usually wins.`,
    blocks,
    button: { label: "Open in BuPulse", url: leadsUrl(lead.id) },
    footer: "You get this email for every new lead. Turn it off, or switch to a daily summary, in Leads > Notifications.",
  });
  return { subject: `New lead: ${leadLabel(lead)} — ${oneLine(businessName)}`, ...mail };
}

/** The daily summary: new leads of the last 24 hours and how many are still waiting for a first reply. */
export function renderDigestEmail(args: { leads: EmailLead[]; openCount: number; businessName: string; timeZone: string }) {
  const { leads, openCount, businessName, timeZone } = args;
  const shown = leads.slice(0, 15);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  const blocks = shown.map((l) => ({
    label: `${time.format(l.createdAt)} · ${sourceLabel(l.source)}`,
    value: [leadLabel(l), [l.email, l.phone].filter(Boolean).join(" · "), clip(oneLine(l.interest || l.message || ""), 160)].filter(Boolean).join("\n"),
  }));
  if (leads.length > shown.length) blocks.push({ label: "More", value: `and ${leads.length - shown.length} more in BuPulse.` });
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const intro = [
    leads.length ? `${plural(leads.length, "new lead", "new leads")} in the last 24 hours.` : "No new leads in the last 24 hours.",
    openCount ? `${plural(openCount, "lead is", "leads are")} still marked New and waiting for a first reply.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const mail = renderEmail({
    heading: `Your leads today, ${businessName}`,
    intro,
    blocks,
    button: { label: "Open your leads", url: leadsUrl() },
    footer: "You get this summary every morning when there is something to report. Change it in Leads > Notifications.",
  });
  return { subject: `${plural(leads.length, "new lead", "new leads")} · ${openCount} open — ${oneLine(businessName)}`, ...mail };
}
