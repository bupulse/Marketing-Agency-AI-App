import type { Metadata } from "next";
import { BackgroundBlobs } from "@/components/motion";
import { HelpChatPage } from "@/components/support-chat/help-chat-page";

export const metadata: Metadata = {
  title: "Help chat",
  robots: { index: false, follow: false },
};

// The help chat on a page of its own (docs/SUPPORT_CHAT.md "10. Visitor chat"). The "Made with BuPulse" link on
// link-in-bio pages opens it with ?from=bio: sales mode ("want a page like this?"), no greeting.
export default async function HelpChat({ searchParams }: PageProps<"/help-chat">) {
  const from = (await searchParams).from;
  return (
    <main className="relative flex min-h-dvh flex-1 items-center justify-center sm:p-6">
      <BackgroundBlobs />
      <HelpChatPage surface={from === "bio" ? "bio" : "public"} />
    </main>
  );
}
