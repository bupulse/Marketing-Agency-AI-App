import { requirePermission } from "@/lib/admin/auth";
import { inboxAdminView } from "@/lib/social/inbox/admin";
import { InboxServicePage } from "@/components/admin/system/services/more-services";

export const metadata = { title: "Instagram and Facebook replies" };

/** Admin -> Services -> Instagram and Facebook replies: the route comments and DMs take, and the Composio budget. */
export default async function InboxServiceRoute() {
  await requirePermission("system"); // pages render alongside the layout, so check here too
  return <InboxServicePage view={await inboxAdminView()} />;
}
