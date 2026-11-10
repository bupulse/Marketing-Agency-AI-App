"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { Bot, Hourglass, Inbox, MessagesSquare, Search, UserRound, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { agentTopic, STAFF_TOPICS } from "@/lib/support/contract";
import type { ListView } from "@/lib/support/app-client/api";
import { ago, conversationTags, matchesSearch, sortConversations, viewCounts, waitingTimer } from "@/lib/support/app-client/lists";
import { useSupportApp } from "./app-context";
import { Conversation } from "./conversation";
import { diffList, type ListMemory } from "./chat/helpers";
import { Avatar } from "./chat/message";
import { ChatStyles, LiveDot, TypingDots } from "./chat/styles";
import { TagList } from "./tags";
import { useLiveQuery, useNow } from "./use-live";

const VIEWS: { value: ListView; label: string; hint: string; icon: ComponentType<{ className?: string }> }[] = [
  { value: "mine", label: "Mine", hint: "Chats you are answering now.", icon: UserRound },
  { value: "waiting", label: "Waiting", hint: "People waiting for a person, longest wait first.", icon: Hourglass },
  { value: "ai", label: "AI", hint: "The AI is answering these. Step in any time.", icon: Bot },
  { value: "all", label: "All", hint: "Every chat. Closed ones go last.", icon: Inbox },
];

const NONE: ReadonlySet<string> = new Set();

/**
 * Chats: the lists (Mine, Waiting, AI, All) as chips with search, the open chat and the facts beside it. On a phone
 * the list, the chat and its facts are steps, full width, each with a back button. The open chat is in the address
 * (?c=), so a link or a notification opens it. New chats rise into the list and updated ones flash.
 */
export function ChatsView({ initialId }: { initialId: string | null }) {
  const { api, me } = useSupportApp();
  const [view, setView] = useState<ListView>(initialId ? "all" : "mine");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(initialId);
  const now = useNow();
  const topics = [STAFF_TOPICS.inbox, agentTopic(me.id)];
  const listKey = `${view}:${q.trim()}`;
  const list = useLiveQuery(() => api.conversations(view, q.trim() || undefined), { topics, key: listKey });
  const all = useLiveQuery(() => api.conversations("all"), { topics, key: "all" });
  const counts = all.data ? viewCounts(all.data.items, me) : null;
  const items = list.data ? sortConversations(list.data.items.filter((c) => matchesSearch(c, q))) : null;

  // What changed since the list was last loaded (the first load of a tab or search marks nothing).
  const [diff, setDiff] = useState<{ data: unknown; key: string; memory: ListMemory | null; fresh: ReadonlySet<string>; bumped: ReadonlySet<string> }>({ data: null, key: "", memory: null, fresh: NONE, bumped: NONE });
  if (list.data && list.data !== diff.data) setDiff({ data: list.data, key: listKey, ...diffList(diff.key === listKey ? diff.memory : null, list.data.items) });

  const root = useRef<HTMLDivElement>(null);
  // On a phone an open chat fills the screen like a chat app (the app bar scrolls away); back shows the list again.
  const fitPhone = useCallback((chat: boolean) => {
    if (window.innerWidth >= 1024) return;
    requestAnimationFrame(() => (chat ? root.current?.scrollIntoView({ block: "start" }) : window.scrollTo({ top: 0 })));
  }, []);
  useEffect(() => {
    if (initialId) fitPhone(true);
  }, [initialId, fitPhone]);

  const open = useCallback(
    (id: string | null) => {
      setSelected(id);
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("c", id);
      else url.searchParams.delete("c");
      window.history.replaceState(null, "", url);
      fitPhone(!!id);
    },
    [fitPhone],
  );
  const current = VIEWS.find((v) => v.value === view)!;

  return (
    <div ref={root} className={cn("flex min-h-0 flex-1 overflow-x-clip lg:h-dvh lg:flex-none", selected && "max-lg:h-dvh max-lg:flex-none")}>
      <ChatStyles />
      <section aria-label="Chat list" className={cn("flex w-full flex-col border-r border-line bg-surface lg:w-[340px] lg:shrink-0 xl:w-[360px]", selected && "hidden lg:flex")}>
        <div className="flex flex-col gap-3 px-4 pb-3 pt-4">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-[20px] font-bold tracking-[-0.02em]">Chats</h1>
            {counts && counts.waiting > 0 ? (
              <button type="button" onClick={() => setView("waiting")} className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full bg-danger-bg px-2.5 text-[12px] font-semibold text-danger">
                <LiveDot className="bg-danger" /> {counts.waiting} waiting
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted">
                <LiveDot /> Live
              </span>
            )}
          </div>
          <label className="relative flex">
            <span className="sr-only">Search chats</span>
            <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, email, business…"
              className="min-h-11 w-full rounded-full border border-line bg-bg pl-10 pr-10 text-sm outline-none transition-shadow focus:border-pulse-blue/50 focus:shadow-ring [&::-webkit-search-cancel-button]:hidden"
            />
            {q && (
              <button type="button" aria-label="Clear the search" onClick={() => setQ("")} className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft">
                <X aria-hidden className="size-4" />
              </button>
            )}
          </label>
          <div role="tablist" aria-label="Which chats" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 pt-0.5">
            {VIEWS.map((v) => {
              const on = view === v.value;
              const n = counts ? counts[v.value] : null;
              const alarm = v.value === "waiting" && !!n;
              return (
                <button
                  key={v.value}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setView(v.value)}
                  className={cn(
                    "inline-flex min-h-10 flex-1 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full border px-2.5 text-[13px] font-semibold transition-[background-color,border-color,color,transform] duration-200 hover:-translate-y-px active:translate-y-0 motion-reduce:transform-none",
                    on
                      ? "border-transparent bg-graphite text-white shadow-[0_8px_18px_-12px_rgba(17,24,39,0.8)] dark:bg-white dark:text-graphite"
                      : alarm
                        ? "border-danger/35 bg-danger-bg text-danger"
                        : "border-line bg-surface text-text hover:bg-soft",
                  )}
                >
                  {v.label}
                  {n != null && (
                    <span key={n} className={cn("sc-pop min-w-5 rounded-full px-1.5 text-center text-[11.5px] tabular-nums", on ? "bg-white/20 dark:bg-graphite/15" : alarm ? "bg-[#c81e3a] text-white" : "bg-soft")}>{n}</span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-[12.5px] text-muted">{current.hint}</p>
        </div>
        <ul key={listKey} className="sc-stagger sc-scroll flex flex-1 flex-col gap-1.5 overflow-y-auto px-2.5 pb-3">
          {list.error && !items && <li role="alert" className="px-3 py-4 text-sm text-danger">{list.error}</li>}
          {!items && !list.error && (
            <li className="flex items-center gap-2 px-3 py-4 text-sm text-muted" role="status">
              <TypingDots /> Loading chats…
            </li>
          )}
          {items?.length === 0 && (
            <li className="mx-1 mt-2 flex flex-col items-center gap-2 rounded-[20px] border border-dashed border-line px-4 py-8 text-center">
              <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-soft text-ok">
                {q ? <Search aria-hidden className="size-5" /> : <current.icon className="size-5" />}
              </span>
              <span className="text-sm text-muted">{q ? "No chat matches that search." : view === "mine" ? "No chats for you right now. Waiting ones show under Waiting." : "Nothing here right now."}</span>
            </li>
          )}
          {items?.map((c) => {
            const on = c.id === selected;
            const waiting = c.status === "WAITING";
            const fresh = diff.key === listKey && diff.fresh.has(c.id);
            const bumped = diff.key === listKey && diff.bumped.has(c.id);
            return (
              <li key={c.id} className={cn(fresh && "sc-pop")}>
                <button
                  type="button"
                  onClick={() => open(c.id)}
                  aria-current={on ? "true" : undefined}
                  className={cn(
                    "group relative flex w-full cursor-pointer items-start gap-3 overflow-hidden rounded-[18px] border p-3 text-left transition-[background-color,border-color,transform,box-shadow] duration-200 hover:-translate-y-px motion-reduce:transform-none",
                    on
                      ? "border-pulse-blue/40 bg-pulse-blue/[0.07] shadow-[0_10px_24px_-18px_rgba(47,107,255,0.8)] dark:bg-pulse-blue/15"
                      : waiting
                        ? "border-danger/25 bg-danger-bg/40 hover:bg-danger-bg/60"
                        : "border-transparent hover:border-line hover:bg-soft",
                    c.status === "CLOSED" && !on && "opacity-70",
                  )}
                >
                  {(fresh || bumped) && <span key={c.lastMessageAt} aria-hidden className="sc-flash pointer-events-none absolute inset-0" />}
                  {waiting && <span aria-hidden className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-danger" />}
                  <span className="relative">
                    <Avatar name={c.visitorName} className="size-10 text-[13px]" />
                    {c.status === "AI" && (
                      <span aria-label="AI answering" className="absolute -bottom-1 -right-1 inline-flex size-[18px] items-center justify-center rounded-full border-2 border-surface bg-pulse-violet text-white">
                        <Bot aria-hidden className="size-2.5" />
                      </span>
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className={cn("truncate", c.unread ? "font-bold" : "font-semibold")}>{c.visitorName}</span>
                        {c.unread && <span aria-label="New messages" className="size-2 shrink-0 rounded-full bg-pulse-blue" />}
                      </span>
                      {waiting && c.waitingSince ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#c81e3a] px-2 py-0.5 text-[11.5px] font-bold tabular-nums text-white">
                          <Hourglass aria-hidden className="size-3" />
                          {waitingTimer(c.waitingSince, now)}
                          <span className="sr-only"> waiting</span>
                        </span>
                      ) : (
                        <span className="shrink-0 text-xs font-medium text-muted">{ago(c.lastMessageAt, now)}</span>
                      )}
                    </span>
                    {c.businessName && <span className="-mt-0.5 truncate text-[12px] text-muted">{c.businessName}</span>}
                    <span className={cn("line-clamp-1 text-[13px]", c.unread ? "text-text" : "text-muted")}>{c.preview}</span>
                    <TagList tags={conversationTags(c)} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      {selected ? (
        <Conversation key={selected} id={selected} onBack={() => open(null)} onOpenChat={open} />
      ) : (
        <div className="hidden flex-1 items-center justify-center bg-[#fafafb] p-6 lg:flex dark:bg-transparent">
          <div className="sc-rise flex max-w-sm flex-col items-center gap-3 text-center">
            <span className="inline-flex size-16 items-center justify-center rounded-[22px] bg-brand-gradient text-white shadow-[0_18px_40px_-18px_rgba(47,107,255,0.9)]">
              <MessagesSquare aria-hidden className="size-7" />
            </span>
            <h2 className="text-lg font-bold">Pick a chat on the left</h2>
            <p className="text-sm text-muted">
              {counts ? (counts.waiting ? `${counts.waiting} ${counts.waiting === 1 ? "person is" : "people are"} waiting for a person. Start with Waiting.` : "Nobody is waiting. The AI is looking after the rest.") : "Loading your chats…"}
            </p>
            {counts && counts.waiting > 0 && view !== "waiting" && (
              <button type="button" onClick={() => setView("waiting")} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-brand-gradient px-5 text-sm font-semibold text-white shadow-[0_10px_22px_-12px_rgba(47,107,255,0.9)]">
                <Hourglass aria-hidden className="size-4" /> Show who is waiting
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
