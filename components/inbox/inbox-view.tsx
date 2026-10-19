"use client";

import { ArrowLeft, Bot, CheckCircle2, Hand, MessageSquareText, RotateCcw, Search, Send, StickyNote, Tag, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { assignTo, changeStatus, loadThread, pauseAutomations, saveNote, sendReply, tagContact } from "@/app/dashboard/inbox/actions";
import { Badge, Button, GlassCard, Input, Select, Textarea, useToast } from "@/components/ui";
import { timeAgo } from "@/components/leads/format";
import { cn } from "@/lib/cn";
import { CHANNEL_LABELS, INBOX_VIEWS, VIEW_LABELS, type ChannelKindValue, type InboxView } from "@/lib/inbox/labels";
import type { InboxItem, Thread } from "@/lib/inbox/service";

type Props = {
  items: InboxItem[];
  hasMore: boolean;
  counts: Record<InboxView, number>;
  view: InboxView;
  channel: ChannelKindValue | null;
  q: string;
  channels: ChannelKindValue[];
  team: { id: string; name: string }[];
  actorId: string;
  initialOpenId: string | null;
};

/** How often the open conversation and the list look for new messages. */
const THREAD_REFRESH_MS = 6000;
const LIST_REFRESH_MS = 15000;

export function InboxView({ items, hasMore, counts, view, channel, q, channels, team, actorId, initialOpenId }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { toast } = useToast();
  const [, startNav] = useTransition();
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [thread, setThread] = useState<Thread | null>(null);
  const [query, setQuery] = useState(q);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navigate = useCallback(
    (next: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v) sp.set(k, v);
        else sp.delete(k);
      }
      startNav(() => router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false }));
    },
    [params, pathname, router],
  );

  const refreshThread = useCallback(async (id: string, quiet = false) => {
    const result = await loadThread(id);
    if (result.ok) setThread(result.thread);
    else if (!quiet) toast(result.error, "error");
  }, [toast]);

  useEffect(() => {
    if (!openId) return;
    let alive = true;
    const load = (quiet: boolean) =>
      loadThread(openId).then((result) => {
        if (!alive) return;
        if (result.ok) setThread(result.thread);
        else if (!quiet) toast(result.error, "error");
      });
    void load(false);
    const timer = setInterval(() => {
      if (!document.hidden) void load(true);
    }, THREAD_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [openId, toast]);
  const loading = !!openId && thread?.id !== openId;

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, LIST_REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);

  function open(id: string | null) {
    setOpenId(id);
    if (!id) setThread(null);
    navigate({ c: id });
  }

  function onSearch(value: string) {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => navigate({ q: value.trim() || null }), 350);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(280px,380px)_1fr]">
      <section aria-label="Conversations" className={cn("flex min-w-0 flex-col gap-3", openId && "hidden lg:flex")}>
        <GlassCard padding="sm" className="flex flex-col gap-3 p-3">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Views">
            {INBOX_VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => navigate({ view: v === "open" ? null : v, c: null })}
                className={cn("min-h-9 rounded-full px-3 text-[13px] font-medium", view === v ? "bg-ink text-white" : "bg-soft text-muted hover:text-text")}
              >
                {VIEW_LABELS[v]}
                {v !== "closed" && v !== "all" && counts[v] > 0 ? <span className="ml-1 opacity-70">{counts[v]}</span> : null}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input value={query} onChange={(e) => onSearch(e.target.value)} placeholder="Search name, phone or message" aria-label="Search conversations" className="pl-9" />
            </div>
            {channels.length > 1 && (
              <Select aria-label="Channel" value={channel ?? ""} onChange={(e) => navigate({ channel: e.target.value || null })} className="w-36">
                <option value="">All channels</option>
                {channels.map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_LABELS[c]}
                  </option>
                ))}
              </Select>
            )}
          </div>
        </GlassCard>

        <GlassCard padding="none" className="overflow-hidden">
          {items.length === 0 ? (
            <p className="p-6 text-center text-[14px] text-muted">{q || channel ? "No conversation matches." : view === "closed" ? "No closed conversations." : "No conversations here yet."}</p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => open(c.id)}
                    aria-current={openId === c.id || undefined}
                    className={cn("flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-soft", openId === c.id && "bg-soft")}
                  >
                    <span aria-hidden className="mt-0.5 flex size-9 flex-none items-center justify-center rounded-full bg-brand-gradient text-[14px] font-semibold text-white">
                      {c.contact.name.replace(/^@/, "").charAt(0).toUpperCase() || "?"}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <span className={cn("truncate text-[14px]", c.unread ? "font-semibold" : "font-medium")}>{c.contact.name}</span>
                        <span className="ml-auto flex-none text-[12px] text-muted">{timeAgo(c.lastMessageAt)}</span>
                      </span>
                      <span className={cn("truncate text-[13px]", c.unread ? "text-text" : "text-muted")}>{c.preview || " "}</span>
                      <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <Badge tone="neutral">{CHANNEL_LABELS[c.channel]}</Badge>
                        {c.unread > 0 && <Badge tone="violet">{c.unread} new</Badge>}
                        {c.botPaused && <Badge tone="blue">Team answering</Badge>}
                        {c.assignee && <span className="truncate text-[12px] text-muted">{c.assignee.id === actorId ? "You" : c.assignee.name}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hasMore && (
            <div className="border-t border-line p-3 text-center text-[13px] text-muted">Showing the most recent conversations. Search to find older ones.</div>
          )}
        </GlassCard>
      </section>

      <section aria-label="Conversation" className={cn("min-w-0", !openId && "hidden lg:block")}>
        {openId && thread && thread.id === openId ? (
          <ThreadPanel thread={thread} team={team} actorId={actorId} onBack={() => open(null)} onChanged={() => void refreshThread(openId, true)} afterChange={() => router.refresh()} />
        ) : (
          <GlassCard className="flex min-h-[320px] flex-col items-center justify-center gap-2 text-center">
            <MessageSquareText aria-hidden className="size-8 text-muted" />
            <p className="text-[15px] font-medium">{loading ? "Opening the conversation…" : "Choose a conversation"}</p>
            <p className="max-w-sm text-[14px] text-muted">Messages from your website chat and connected social accounts arrive here. Answer them, add notes and hand them to a teammate.</p>
          </GlassCard>
        )}
      </section>
    </div>
  );
}

function ThreadPanel({ thread, team, actorId, onBack, onChanged, afterChange }: { thread: Thread; team: { id: string; name: string }[]; actorId: string; onBack: () => void; onChanged: () => void; afterChange: () => void }) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [busy, setBusy] = useState(false);
  const [newTag, setNewTag] = useState("");
  const list = useRef<HTMLOListElement | null>(null);

  // Keep the newest message in view inside the message list (never scroll the whole page).
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [thread.messages.length]);

  // Meta channels only allow replies within 24 hours of the person's last message (worked out on the server).
  const windowClosed = !thread.replyWindowOpen;

  async function submit() {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    if (mode === "note") {
      const r = await saveNote(thread.id, value);
      setBusy(false);
      if (!r.ok) return toast(r.error, "error");
      setText("");
      onChanged();
      return;
    }
    const r = await sendReply(thread.id, value);
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    if (!r.sent) toast(r.error ?? "The message could not be sent.", "error");
    else setText("");
    onChanged();
    afterChange();
  }

  async function act(run: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setBusy(true);
    const r = await run();
    setBusy(false);
    if (!r.ok) return toast(r.error ?? "Something went wrong.", "error");
    toast(done, "success");
    onChanged();
    afterChange();
  }

  async function changeTag(name: string, add: boolean) {
    const r = await tagContact(thread.contact.id, name, add);
    if (!r.ok) return toast(r.error, "error");
    setNewTag("");
    onChanged();
  }

  return (
    <GlassCard padding="none" className="flex min-h-[560px] flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <button type="button" onClick={onBack} className="flex size-9 items-center justify-center rounded-full hover:bg-soft lg:hidden" aria-label="Back to conversations">
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <Link href={`/dashboard/contacts/${thread.contact.id}`} className="block truncate text-[16px] font-semibold hover:underline">
            {thread.contact.name}
          </Link>
          <p className="truncate text-[13px] text-muted">
            {CHANNEL_LABELS[thread.channel]}
            {thread.account ? ` · ${thread.account}` : ""}
            {thread.contact.phone ? ` · ${thread.contact.phone}` : ""}
            {thread.contact.email ? ` · ${thread.contact.email}` : ""}
          </p>
        </div>
        <Select aria-label="Assigned to" value={thread.assigneeId ?? ""} disabled={busy} onChange={(e) => act(() => assignTo(thread.id, e.target.value || null), e.target.value ? "Assigned." : "Unassigned.")} className="w-40">
          <option value="">Unassigned</option>
          {team.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id === actorId ? `${m.name} (you)` : m.name}
            </option>
          ))}
        </Select>
        {thread.status === "OPEN" ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => changeStatus(thread.id, "CLOSED"), "Conversation closed.")}>
            <CheckCircle2 className="size-4" aria-hidden /> Close
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => changeStatus(thread.id, "OPEN"), "Conversation reopened.")}>
            <RotateCcw className="size-4" aria-hidden /> Reopen
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-soft/60 px-4 py-2 text-[13px]">
        {thread.botPausedUntil ? (
          <>
            <Hand className="size-4 text-muted" aria-hidden />
            <span className="text-muted">Automations are paused here until {new Date(thread.botPausedUntil).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}.</span>
            <button type="button" className="font-medium text-pulse-blue underline-offset-2 hover:underline" disabled={busy} onClick={() => act(() => pauseAutomations(thread.id, 0), "Automations resumed.")}>
              Resume automations
            </button>
          </>
        ) : (
          <>
            <Bot className="size-4 text-muted" aria-hidden />
            <span className="text-muted">Automations can answer here.</span>
            <button type="button" className="font-medium text-pulse-blue underline-offset-2 hover:underline" disabled={busy} onClick={() => act(() => pauseAutomations(thread.id, 24), "Automations paused for 24 hours.")}>
              Take over (pause 24 h)
            </button>
          </>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {thread.contact.tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[12px] shadow-glass">
              {t}
              <button type="button" aria-label={`Remove tag ${t}`} onClick={() => changeTag(t, false)} className="text-muted hover:text-text">
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
          <form
            className="inline-flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (newTag.trim()) void changeTag(newTag.trim(), true);
            }}
          >
            <Tag className="size-3.5 text-muted" aria-hidden />
            <input value={newTag} onChange={(e) => setNewTag(e.target.value)} maxLength={40} placeholder="Add tag" aria-label="Add a tag" className="w-24 bg-transparent text-[12px] outline-none placeholder:text-muted" />
          </form>
        </span>
      </div>

      <ol ref={list} className="flex max-h-[60vh] min-h-[240px] flex-1 flex-col gap-2 overflow-y-auto px-4 py-4" aria-live="polite">
        {thread.messages.map((m) => (
          <li key={m.id} className={cn("flex flex-col gap-1", m.direction === "INBOUND" ? "items-start" : "items-end")}>
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[14px]",
                m.kind === "NOTE" ? "border border-dashed border-amber-300 bg-amber-50 text-amber-950" : m.direction === "INBOUND" ? "bg-white shadow-glass" : m.author === "AGENT" ? "bg-ink text-white" : "bg-pulse-blue/10 text-text",
              )}
            >
              {m.kind === "COMMENT" && <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Comment</span>}
              {m.kind === "COMMENT_REPLY" && <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide opacity-70">Public reply</span>}
              {m.kind === "NOTE" && <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide">Team note</span>}
              {m.text}
              {m.buttons.length > 0 && (
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {m.buttons.map((b) => (
                    <span key={b} className="rounded-full border border-current/30 px-2 py-0.5 text-[12px]">
                      {b}
                    </span>
                  ))}
                </span>
              )}
            </div>
            <span className="px-1 text-[11px] text-muted">
              {m.direction === "OUTBOUND" ? (m.author === "AGENT" ? "Team" : m.author === "BOT" ? "Automatic reply" : "BuPulse") + " · " : ""}
              {timeAgo(m.at)}
              {m.status === "FAILED" && <span className="text-red-600"> · Not sent{m.error ? `: ${m.error}` : ""}</span>}
            </span>
          </li>
        ))}
      </ol>

      <footer className="flex flex-col gap-2 border-t border-line p-3">
        <div className="flex gap-1.5" role="tablist" aria-label="Write">
          <button type="button" role="tab" aria-selected={mode === "reply"} onClick={() => setMode("reply")} className={cn("inline-flex min-h-8 items-center gap-1 rounded-full px-3 text-[13px] font-medium", mode === "reply" ? "bg-ink text-white" : "bg-soft text-muted")}>
            <Send className="size-3.5" aria-hidden /> Reply
          </button>
          <button type="button" role="tab" aria-selected={mode === "note"} onClick={() => setMode("note")} className={cn("inline-flex min-h-8 items-center gap-1 rounded-full px-3 text-[13px] font-medium", mode === "note" ? "bg-amber-100 text-amber-950" : "bg-soft text-muted")}>
            <StickyNote className="size-3.5" aria-hidden /> Note for the team
          </button>
        </div>
        {mode === "reply" && windowClosed && (
          <p className="text-[13px] text-muted">This person last wrote more than 24 hours ago. {CHANNEL_LABELS[thread.channel]} only allows replies within 24 hours, so wait for them to write again.</p>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            maxLength={mode === "note" ? 2000 : 4000}
            placeholder={mode === "note" ? "Only your team sees notes" : "Write a reply (Enter to send, Shift+Enter for a new line)"}
            aria-label={mode === "note" ? "Note" : "Reply"}
            className="flex-1"
          />
          <Button onClick={() => void submit()} disabled={busy || !text.trim()} size="sm">
            {mode === "note" ? "Save note" : "Send"}
          </Button>
        </div>
        {mode === "reply" && <p className="text-[12px] text-muted">Replying pauses automations in this conversation for 12 hours.</p>}
      </footer>
    </GlassCard>
  );
}
