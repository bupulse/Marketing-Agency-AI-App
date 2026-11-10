import { Inbox } from "lucide-react";
import { InboxView, inboxShown } from "@/components/admin/inbox-view";
import { PageHeader } from "@/components/admin/kit";
import { requirePermission } from "@/lib/admin/auth";
import { getInbox, inboxFor } from "@/lib/admin/inbox";

export const metadata = { title: "Inbox" };

export default async function InboxPage({ searchParams }: PageProps<"/admin/inbox">) {
  const me = await requirePermission("overview"); // pages render alongside the layout, so check here too
  const [inbox, sp] = await Promise.all([getInbox(), searchParams]);
  const sections = inboxFor(inbox.sections, me.permissions);
  const show = inboxShown(sections, typeof sp.show === "string" ? sp.show : undefined);
  return (
    <>
      <PageHeader icon={Inbox} tone="blue" title="Inbox" description="Everything waiting for a person, most urgent first. Tap a row to open it, or a chip to see one kind." />
      <InboxView sections={sections} show={show} params={sp} />
    </>
  );
}
