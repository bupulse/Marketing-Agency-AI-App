import Link from "next/link";
import { cn } from "@/lib/cn";

export const LIVE_CHAT_TABS = [
  ["agents", "Agents"],
  ["departments", "Departments"],
  ["hours", "Team hours"],
  ["greetings", "Greetings"],
  ["ai", "AI rules"],
  ["leads", "Chat leads"],
] as const;
export type LiveChatTab = (typeof LIVE_CHAT_TABS)[number][0];

/** The tab asked for in ?tab=, or Agents. */
export const liveChatTab = (asked: string): LiveChatTab => LIVE_CHAT_TABS.find(([k]) => k === asked)?.[0] ?? "agents";

/** Server-rendered tab links (?tab=); scrolls sideways on a phone instead of wrapping. */
export function LiveChatTabs({ current }: { current: LiveChatTab }) {
  return (
    <nav aria-label="Live chat settings" className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">
      {LIVE_CHAT_TABS.map(([key, label]) => (
        <Link
          key={key}
          href={`/admin/live-chat?tab=${key}`}
          aria-current={current === key ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3.5 text-sm no-underline",
            current === key ? "border-pulse-blue font-semibold text-text" : "border-transparent font-medium text-muted hover:text-text",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
