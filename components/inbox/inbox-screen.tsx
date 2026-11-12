import { Inbox, MessageCircle, Plug, Workflow } from "lucide-react";
import type { ComponentProps } from "react";
import { KitStyles, PageHeader, SectionCard, SectionGrid } from "@/components/admin/kit";
import { InboxView } from "./inbox-view";

/**
 * The Inbox page (plain data in, so the page and the dev preview draw the same). With no conversation yet it shows the
 * three ways to start getting them, as cards.
 */
export function InboxScreen({ view }: { view: ComponentProps<typeof InboxView> | null }) {
  return (
    <div className="flex flex-col gap-6">
      <KitStyles />
      <PageHeader icon={Inbox} title="Inbox" description="Messages from your website chat, Instagram and Facebook in one place. Answer, add a note or pass it to a teammate." />
      {view ? (
        <InboxView {...view} />
      ) : (
        <section aria-labelledby="inbox-start" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 px-1">
            <h2 id="inbox-start" className="text-[18px] font-bold tracking-[-0.02em]">No conversations yet</h2>
            <p className="text-[14px] text-muted">Pick one way to start. Messages land here as soon as people write.</p>
          </div>
          <SectionGrid>
            <SectionCard href="/dashboard/widget" icon={MessageCircle} title="Put the chat on your website" hint="Visitors ask, the chat answers from your business facts." />
            <SectionCard href="/dashboard/connections" icon={Plug} tone="violet" title="Connect Instagram or Facebook" hint="Switch on “Answer comments and messages” for an account." />
            <SectionCard href="/dashboard/automations" icon={Workflow} tone="indigo" title="Let automations answer" hint="Send prices and opening hours to the common questions." />
          </SectionGrid>
        </section>
      )}
    </div>
  );
}
