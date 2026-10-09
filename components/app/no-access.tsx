import { Lock } from "lucide-react";
import { getAppContext } from "./context";
import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";
import { askMessage, can, type Permission } from "@/lib/team/roles";

/**
 * Pages that need more than the Member role start with `const blocked = await pageGate("billing"); if (blocked) return blocked;`.
 * The matching actions and routes check the role again on the server; this only replaces the page with a friendly message.
 */
export async function pageGate(permission: Permission) {
  const { role } = await getAppContext();
  if (can(role, permission)) return null;
  return (
    <>
      <PageHeader title="Not available for your role" description="This part of BuPulse is managed by your company's owner or admins." />
      <EmptyState icon={Lock} title="Ask your company owner" text={askMessage(permission)} />
    </>
  );
}
