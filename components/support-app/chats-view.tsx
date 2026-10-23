"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/cn";
import { agentTopic, STAFF_TOPICS } from "@/lib/support/contract";
import type { ListView } from "@/lib/support/app-client/api";
import { ago, conversationTags, matchesSearch, sortConversations, viewCounts, waitingTimer } from "@/lib/support/app-client/lists";
import { useSupportApp } from "./app-context";
import { Conversation } from "./conversation";
import { TagList } from "./tags";
import { useLiveQuery, useNow } from "./use-live";

const VIEWS: { value: ListView; label: string }[] = [
  { value: "mine", label: "Mine" },
  { value: "waiting", label: "Waiting" },
  { value: "ai", label: "AI" },
  { value: "all", label: "All" },
];

/**
 * Chats: the lists (Mine, Waiting, AI, All) with search, the open chat and the facts beside it. On a phone the list
 * and the chat take turns, full width, with a back button. The open chat is in the address (?c=), so a link or a
 * notification opens it.
 */
export function ChatsView({ initialId }: { initialId: string | null }) {
  const { api, me } = useSupportApp();
  const [view, setView] = useState<ListView>(initialId ? "all" : "mine");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(initialId);
  const now = useNow();
  const topics = [STAFF_TOPICS.inbox, agentTopic(me.id)];
  const list = useLiveQuery(() => api.conversations(view, q.trim() || undefined), { topics, key: `${view}:${q.trim()}` });
  const all = useLiveQuery(() => api.conversations("all"), { topics, key: "all" });
  const counts = all.data ? viewCounts(all.data.items, me) : null;
  const items = list.data ? sortConversations(list.data.items.filter((c) => matchesSearch(c, q))) : null;

  const open = useCallback((id: string | null) => {
    setSelected(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("c", id);
    else url.searchParams.delete("c");
    window.history.replaceState(null, "", url);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 lg:h-dvh">
      <section aria-label="Chat list" className={cn("flex w-full flex-col border-r border-line bg-surface lg:w-[320px] lg:shrink-0 xl:w-[340px]", selected && "hidden lg:flex")}>
        <div className="flex flex-col gap-2.5 px-4 pb-2.5 pt-4">
          <div role="tablist" aria-label="Which chats" className="flex gap-1 rounded-xl bg-bg p-1">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                role="tab"
                aria-selected={view === v.value}
                onClick={() => setView(v.value)}
                className={cn("min-h-9 flex-1 cursor-pointer rounded-[9px] px-1 text-[13px]", view === v.value ? "bg-surface font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-white/10" : "text-muted")}
              >
                {v.label}
                {counts && v.value !== "all" ? ` ${counts[v.value]}` : ""}
              </button>
            ))}
          </div>
          <label className="flex">
            <span className="sr-only">Search chats</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, business…" className="min-h-11 w-full rounded-xl border border-line bg-transparent px-3 text-sm outline-none focus:shadow-ring" />
          </label>
        </div>
        <ul className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
          {list.error && !items && <li role="alert" className="px-3 py-4 text-sm text-danger">{list.error}</li>}
          {!items && !list.error && <li className="px-3 py-4 text-sm text-muted">Loading…</li>}
          {items?.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{q ? "No chat matches that search." : view === "mine" ? "No chats for you right now. Waiting ones show under Waiting." : "Nothing here right now."}</li>}
          {items?.map((c) => {
            const on = c.id === selected;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => open(c.id)}
                  aria-current={on ? "true" : undefined}
                  className={cn("flex w-full cursor-pointer flex-col gap-1.5 rounded-[14px] border p-3 text-left", on ? "border-pulse-blue/30 bg-pulse-blue/8" : "border-transparent hover:bg-soft")}
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {c.unread && <span aria-label="New messages" className="size-2 shrink-0 rounded-full bg-pulse-blue" />}
                      <span className="truncate">{c.visitorName}</span>
                    </span>
                    {c.status === "WAITING" && c.waitingSince ? (
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-danger">waiting {waitingTimer(c.waitingSince, now)}</span>
                    ) : (
                      <span className="shrink-0 text-xs font-medium text-muted">{ago(c.lastMessageAt, now)}</span>
                    )}
                  </span>
                  <span className="line-clamp-1 text-[13px] text-muted">{c.preview}</span>
                  <TagList tags={conversationTags(c)} />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      {selected ? (
        <Conversation key={selected} id={selected} onBack={() => open(null)} onOpenChat={open} />
      ) : (
        <div className="hidden flex-1 items-center justify-center p-6 text-sm text-muted lg:flex">Pick a chat on the left.</div>
      )}
    </div>
  );
}
