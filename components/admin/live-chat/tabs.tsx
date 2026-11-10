import Link from "next/link";
import { Bot, Clock3, Hand, Network, UserPlus, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { FOCUS } from "../kit";

export const LIVE_CHAT_TABS = [
  ["agents", "Agents"],
  ["departments", "Departments"],
  ["hours", "Team hours"],
  ["greetings", "Greetings"],
  ["ai", "AI rules"],
  ["leads", "Chat leads"],
] as const;
export type LiveChatTab = (typeof LIVE_CHAT_TABS)[number][0];

/** Each part's icon and its one plain line (the hub cards and the page headers). */
export const LIVE_CHAT_LOOK: Record<LiveChatTab, { icon: LucideIcon; hint: string }> = {
  agents: { icon: Users, hint: "Who answers the chats: invite, edit, lock, and answer join requests." },
  departments: { icon: Network, hint: "Visitors pick one when they start a chat; it reaches the agents in it." },
  hours: { icon: Clock3, hint: "When the team is in, Kigali time. Outside them the AI keeps answering." },
  greetings: { icon: Hand, hint: "The small bubble near the chat button, a different one per page." },
  ai: { icon: Bot, hint: "The AI's switch, its tone, and the topics it always hands to a person." },
  leads: { icon: UserPlus, hint: "Visitors who left their name, email and business before asking." },
};

/** The tab asked for in ?tab=, or Agents. */
export const liveChatTab = (asked: string): LiveChatTab => LIVE_CHAT_TABS.find(([k]) => k === asked)?.[0] ?? "agents";

/** The parts of Live chat as chips (?tab= links), to hop between them; scrolls sideways on a phone. */
export function LiveChatTabs({ current }: { current: LiveChatTab }) {
  return (
    <nav aria-label="Live chat settings" className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
      <ul className="flex w-max gap-2">
        {LIVE_CHAT_TABS.map(([key, label]) => (
          <li key={key}>
            <Link
              href={`/admin/live-chat?tab=${key}`}
              aria-current={current === key ? "page" : undefined}
              className={cn(
                "inline-flex min-h-10 shrink-0 items-center rounded-full border-2 px-3.5 text-[13px] font-semibold no-underline transition-colors duration-200 motion-reduce:transition-none",
                FOCUS,
                current === key ? "border-[#0e7490] bg-[#0e7490]/[0.08] text-text dark:border-[#22d3ee] dark:bg-[#22d3ee]/10" : "border-line bg-surface text-muted hover:border-[#0e7490]/40 hover:text-text dark:bg-white/[0.03]",
              )}
            >{label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
