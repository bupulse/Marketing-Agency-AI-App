import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { LeadAlertsScreen } from "@/components/leads/lead-alerts-screen";
import { LeadsScreen } from "@/components/leads/leads-screen";
import { previewAllowed } from "@/lib/support/preview";
import { ContactsScreen } from "@/components/contacts/contacts-screen";
import { InboxScreen } from "@/components/inbox/inbox-screen";
import { WidgetScreen, greetingIdeasFor } from "@/components/widget/widget-screen";
import { SAMPLE_CONTACTS, SAMPLE_CONVERSATIONS,SAMPLE_FIELDS, SAMPLE_LEAD_COUNTS, SAMPLE_LEADS, SAMPLE_TAGS } from "../sample-data";

export const metadata = { title: "Client preview" };

type SP = Record<string, string | string[] | undefined>;

/** Each screen with made-up data. `?empty=1` shows a screen's empty state where it has one. */
const SCREENS: Record<string, (sp: SP) => ReactNode | Promise<ReactNode>> = {
  leads: (sp) => (
    <LeadsScreen
      chatOn
      inPlan
      addChatHref="#"
      alertsHref="/preview-c/leads-alerts"
      alerts={{ summary: "Email and daily summary" }}
      inbox={sp.empty ? null : { leads: SAMPLE_LEADS, total: 5, hasMore: false, limit: 50, counts: SAMPLE_LEAD_COUNTS, sources: ["website_chat", "instagram", "contact_form"], filters: {}, initialOpenId: typeof sp.lead === "string" ? sp.lead : null }}
    />
  ),
  "leads-alerts": () => (
    <LeadAlertsScreen backHref="/preview-c/leads" push={{ publicKey: "BPreviewKeyOnly", registered: [] }} notifications={{ initial: { notifyInstant: true, notifyDaily: true }, email: "aline@example.com", whatsapp: { enabled: false, number: null, fallback: "+250 700 000 000" } }} />
  ),
  inbox: (sp) => (
    <InboxScreen
      view={sp.empty ? null : { items: SAMPLE_CONVERSATIONS, hasMore: false, counts: { open: 3, mine: 1, unassigned: 2, closed: 0, all: 2 }, view: "open", channel: null, q: "", channels: ["WEBSITE", "INSTAGRAM", "FACEBOOK"], team: [{ id: "me", name: "Aline" }], actorId: "me", initialOpenId: null }}
    />
  ),
  widget: (sp) => (
    <WidgetScreen
      initial={{ enabled: true, greeting: "", position: "right", accentColor: "", allowedDomains: sp.empty ? [] : ["inzozi.example.com"] }}
      defaultGreeting="Hi! Welcome to Inzozi Juice Bar. How can we help?"
      defaultAccent="#2f6bff"
      brandColors={["#2f6bff", "#16a34a"]}
      widgetKey="preview"
      baseUrl="https://bupulse.com"
      usage={{ used: 140, limit: 500 }}
      greetingIdeas={greetingIdeasFor("English")}
      suggestedDomains={["inzozi.example.com"]}
    />
  ),
  contacts: () => <ContactsScreen contacts={SAMPLE_CONTACTS} total={4} hasMore={false} q="" tag={null} channel={null} tags={SAMPLE_TAGS} fields={SAMPLE_FIELDS} canManage />,
};

export default async function ClientPreviewPage({ params, searchParams }: PageProps<"/preview-c/[[...screen]]">) {
  if (!previewAllowed()) notFound();
  const [{ screen }, sp] = await Promise.all([params, searchParams]);
  const which = screen?.[0];
  if (!which) {
    return (
      <ul className="flex flex-col gap-2 p-4">
        {Object.keys(SCREENS).map((k) => (
          <li key={k}>
            <Link href={`/preview-c/${k}`}>{k}</Link>
          </li>
        ))}
      </ul>
    );
  }
  if (!Object.hasOwn(SCREENS, which) || (screen?.length ?? 0) > 1) notFound();
  return SCREENS[which](sp);
}
