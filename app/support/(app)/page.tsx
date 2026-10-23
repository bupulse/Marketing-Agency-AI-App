import { ChatsView } from "@/components/support-app/chats-view";
import { requireSupportAgentPage } from "@/lib/support/app-auth";

export const metadata = { title: "Chats" };

export default async function SupportChatsPage({ searchParams }: PageProps<"/support">) {
  await requireSupportAgentPage(); // pages render alongside the layout, so check here too
  const { c } = await searchParams;
  return <ChatsView initialId={typeof c === "string" && /^[\w-]{1,40}$/.test(c) ? c : null} />;
}
