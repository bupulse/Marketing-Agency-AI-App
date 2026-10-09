import { Lock } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app";
import { PERMISSIONS, askMessage, type Permission } from "@/lib/team/roles";

export const metadata = { title: "Not available for your role" };

// Where a server action sends someone whose role may not do what they asked. The action already refused on the server.
export default async function NoAccessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { need } = await searchParams;
  const permission = typeof need === "string" && need in PERMISSIONS ? (need as Permission) : "settings";
  return (
    <>
      <PageHeader title="Not available for your role" description="This part of BuPulse is managed by your company's owner or admins." />
      <EmptyState icon={Lock} title="Ask your company owner" text={askMessage(permission)} />
    </>
  );
}
