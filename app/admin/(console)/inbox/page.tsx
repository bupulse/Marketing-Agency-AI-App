import { PageHeader } from "@/components/app";
import { InboxView } from "@/components/admin/inbox-view";
import { requirePermission } from "@/lib/admin/auth";
import { getInbox, inboxFor } from "@/lib/admin/inbox";

export const metadata = { title: "Inbox" };

export default async function InboxPage() {
  const me = await requirePermission("overview"); // pages render alongside the layout, so check here too
  const inbox = await getInbox();
  return (
    <>
      <PageHeader title="Inbox" description="Everything waiting for a person, most urgent first. Each card opens the page where you act on it." />
      <InboxView sections={inboxFor(inbox.sections, me.permissions)} />
    </>
  );
}
