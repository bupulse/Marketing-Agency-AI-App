"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRightLeft, Bot, Check, CircleCheck, Hand, Info, RotateCcw, Sparkles, UserRound, Users } from "lucide-react";
import { Button, Dialog, Field, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { conversationTopic, DEPARTMENT_KEYS, type Assist, type ConversationDetail, type DepartmentKey } from "@/lib/support/contract";
import type { TeamMember } from "@/lib/support/app-client/api";
import { DEPARTMENT_NAMES, conversationTags } from "@/lib/support/app-client/lists";
import { useSupportApp } from "./app-context";
import { ChatAside } from "./chat-aside";
import { Composer } from "./chat/composer";
import { messageRuns } from "./chat/helpers";
import { Avatar, MessageBubble, TypingBubble } from "./chat/message";
import { ChatStyles, LiveDot, TypingDots } from "./chat/styles";
import { TagList } from "./tags";
import { useLiveQuery } from "./use-live";

const STATUS_DOT: Record<ConversationDetail["status"], string> = {
  AI: "bg-pulse-violet",
  WAITING: "bg-danger",
  OPEN: "bg-success",
  PENDING: "bg-[#d08700]",
  CLOSED: "bg-muted",
};

function statusLine(d: ConversationDetail, me: string): string {
  const parts = [`Chat #${d.number}`];
  if (d.department) parts.push(DEPARTMENT_NAMES[d.department]);
  if (d.status === "AI") parts.push("AI answering");
  else if (d.status === "WAITING") parts.push("waiting for a person");
  else if (d.status === "CLOSED") parts.push("closed");
  else if (d.status === "PENDING") parts.push("ticket: the team follows up");
  else parts.push(d.assigneeName === me ? "assigned to you" : d.assigneeName ? `with ${d.assigneeName}` : "open");
  return parts.join(" · ");
}

const AVAILABILITY_DOT: Record<TeamMember["availability"], string> = { online: "bg-success", away: "bg-[#d08700]", offline: "bg-muted/50" };

const choice = (on: boolean) =>
  cn(
    "relative flex cursor-pointer rounded-2xl border-2 text-left outline-none transition-[transform,border-color,background-color] duration-200 focus-visible:ring-4 focus-visible:ring-pulse-blue/30 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 motion-reduce:transform-none",
    on ? "border-pulse-blue bg-pulse-blue/[0.07] dark:bg-pulse-blue/15" : "border-line bg-surface hover:border-pulse-blue/40",
  );

function Tick() {
  return (
    <span aria-hidden className="absolute -right-1.5 -top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-pulse-blue text-white shadow">
      <Check className="size-3" strokeWidth={3.5} />
    </span>
  );
}

/** Transfer to a colleague or a department's queue: every choice a tile, the note internal. */
function TransferDialog({ open, onClose, detail, onDone }: { open: boolean; onClose: () => void; detail: ConversationDetail; onDone: (d: ConversationDetail) => void }) {
  const { api, me, fail } = useSupportApp();
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [to, setTo] = useState<"agent" | "department">("agent");
  const [agentId, setAgentId] = useState<string | null>(null);
  const [department, setDepartment] = useState<DepartmentKey>(detail.department ?? "sales");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (open && !team) api.team().then((r) => setTeam(r.agents.filter((a) => a.id !== me.id)), (e) => setError(fail(e)));
  }, [open, team, api, me.id, fail]);
  const ready = to === "department" || !!agentId;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Transfer this chat" description="To a colleague, or to a department's queue. Your note is internal: the client can’t see it.">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready) return;
          const f = new FormData(e.currentTarget);
          const note = String(f.get("note") ?? "").trim() || undefined;
          setPending(true);
          try {
            const d = await api.assign(detail.id, to === "agent" ? { agentId: agentId!, note } : { department, note });
            onDone(d);
            onClose();
          } catch (err) {
            setError(fail(err));
          } finally {
            setPending(false);
          }
        }}
      >
        <div role="radiogroup" aria-label="Transfer to" className="grid grid-cols-2 gap-2.5">
          {(
            [
              { value: "agent", label: "A colleague", hint: "One person takes it", icon: <UserRound aria-hidden className="size-5" /> },
              { value: "department", label: "A department", hint: "The next free person", icon: <Users aria-hidden className="size-5" /> },
            ] as const
          ).map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={to === o.value} onClick={() => setTo(o.value)} className={cn(choice(to === o.value), "flex-col gap-1 p-3")}>
              <span className={cn("inline-flex size-9 items-center justify-center rounded-xl", to === o.value ? "bg-brand-gradient text-white" : "bg-soft")}>{o.icon}</span>
              <span className="text-sm font-semibold">{o.label}</span>
              <span className="text-xs text-muted">{o.hint}</span>
              {to === o.value && <Tick />}
            </button>
          ))}
        </div>
        {to === "agent" ? (
          <div role="radiogroup" aria-label="Colleague" className="flex max-h-[240px] flex-col gap-2 overflow-y-auto p-1">
            {!team && !error && <p className="px-1 text-sm text-muted">Loading the team…</p>}
            {team?.length === 0 && <p className="px-1 text-sm text-muted">Nobody else on the team yet.</p>}
            {team?.map((a) => {
              const on = agentId === a.id;
              return (
                <button key={a.id} type="button" role="radio" aria-checked={on} disabled={a.availability === "offline"} onClick={() => setAgentId(a.id)} className={cn(choice(on), "items-center gap-3 p-2.5")}>
                  <span className="relative">
                    <Avatar name={a.name} className="size-9" />
                    <span aria-hidden className={cn("absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-surface", AVAILABILITY_DOT[a.availability])} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold">{a.name}</span>
                    <span className="text-xs text-muted">
                      {a.availability} · {a.openChats}/{a.maxChats} chats
                    </span>
                  </span>
                  {on && <Tick />}
                </button>
              );
            })}
          </div>
        ) : (
          <div role="radiogroup" aria-label="Department" className="flex flex-wrap gap-2">
            {DEPARTMENT_KEYS.map((k) => {
              const on = department === k;
              return (
                <button key={k} type="button" role="radio" aria-checked={on} onClick={() => setDepartment(k)} className={cn("inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors", on ? "border-pulse-blue bg-pulse-blue/[0.08] text-ok dark:bg-pulse-blue/15" : "border-line hover:bg-soft")}>
                  {on && <Check aria-hidden className="size-4" strokeWidth={3} />}
                  {DEPARTMENT_NAMES[k]}
                </button>
              );
            })}
          </div>
        )}
        <Field label="Note for them (optional)">
          <Textarea name="note" rows={2} maxLength={500} placeholder="What they should know" />
        </Field>
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={pending || !ready}>{pending ? "Transferring…" : "Transfer"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function Action({ onClick, disabled, tone = "outline", icon, children }: { onClick: () => void; disabled: boolean; tone?: "primary" | "outline" | "dark"; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-semibold transition-[transform,box-shadow,background-color] duration-200 hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transform-none",
        tone === "primary" && "bg-brand-gradient text-white shadow-[0_10px_22px_-12px_rgba(47,107,255,0.9)]",
        tone === "outline" && "border border-line bg-surface hover:bg-soft",
        tone === "dark" && "bg-graphite text-white dark:bg-white dark:text-graphite",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

type Typing = { who: "visitor" | "ai"; draft: string; after: string | undefined };

/**
 * One chat: the header with its quick actions, the AI summary, the messages, the reply box, and the facts beside it.
 * On a phone it is a step: back to the list on the left, "Info" opens the facts as a third step with its own back.
 */
export function Conversation({ id, onBack, onOpenChat }: { id: string; onBack: () => void; onOpenChat: (id: string) => void }) {
  const { api, me, hub, fail } = useSupportApp();
  const { toast } = useToast();
  const { data, error, reload } = useLiveQuery(() => api.conversation(id), { topics: [conversationTopic(id)], key: id, match: (e) => e.type !== "typing" });
  // An action's answer shows at once and stays until the next load brings the chat again.
  const [local, setLocal] = useState<{ from: ConversationDetail | null; value: ConversationDetail } | null>(null);
  const detail = local && local.from === data ? local.value : data;
  const setDetail = (value: ConversationDetail) => setLocal({ from: data, value });
  const [assist, setAssist] = useState<Assist | null>(null);
  const [typing, setTyping] = useState<Typing | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [about, setAbout] = useState(false);
  const [busy, setBusy] = useState(false);
  // The messages already there when the chat opened: they show at once; anything after them animates in.
  const [history, setHistory] = useState<ReadonlySet<string> | null>(null);
  if (detail && history === null) setHistory(new Set(detail.messages.map((m) => m.id)));
  const scroller = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const pinned = useRef(true);

  const lastId = detail?.messages.at(-1)?.id;
  const lastRef = useRef(lastId);
  useEffect(() => {
    lastRef.current = lastId;
  }, [lastId]);
  useEffect(() => {
    if (!lastId) return;
    let stop = false;
    api.assist(id).then((a) => !stop && setAssist(a), () => undefined);
    return () => {
      stop = true;
    };
  }, [api, id, lastId]);
  // A typing line hides as soon as a new message arrives (it belongs to the message it came after).
  const shownTyping = typing && typing.after === lastId ? typing : null;
  // The messages stay pinned to the newest one while the agent is at the bottom (also when the reply box or the
  // suggestions change size); scrolling up to read older messages unpins it until they come back down.
  useEffect(() => {
    if (!lastId || (scrolled.current && !pinned.current)) return;
    const box = scroller.current;
    box?.scrollTo({ top: box.scrollHeight, behavior: scrolled.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto" });
    scrolled.current = true;
  }, [lastId, shownTyping]);
  const ready = !!detail;
  useEffect(() => {
    const box = scroller.current;
    if (!ready || !box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (pinned.current) box.scrollTop = box.scrollHeight;
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [ready]);
  useEffect(() => {
    let clear: ReturnType<typeof setTimeout> | null = null;
    const off = hub.subscribe([conversationTopic(id)], (e) => {
      if (e.type !== "typing" || e.who === "agent") return;
      setTyping({ who: e.who, draft: e.who === "visitor" ? (e.draft ?? "") : "", after: lastRef.current });
      if (clear) clearTimeout(clear);
      clear = setTimeout(() => setTyping(null), e.who === "ai" ? 15000 : 6000);
    });
    return () => {
      off();
      if (clear) clearTimeout(clear);
    };
  }, [hub, id]);

  async function act(run: () => Promise<ConversationDetail>, done: string) {
    setBusy(true);
    try {
      setDetail(await run());
      toast(done, "success");
    } catch (e) {
      toast(fail(e), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return (
      <section aria-label="Chat" className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#fafafb] p-6 text-sm text-muted dark:bg-transparent">
        <ChatStyles />
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <p className="flex items-center gap-2" role="status">
            <TypingDots /> Loading the chat…
          </p>
        )}
        <Button variant="outline" size="sm" className="lg:hidden" onClick={onBack} leading={<ArrowLeft aria-hidden className="size-4" />}>All chats</Button>
      </section>
    );
  }
  const mine = detail.assigneeName === me.name && detail.status === "OPEN";
  const summary = detail.summary ?? assist?.summary ?? null;
  const runs = messageRuns(detail.messages);
  const tags = conversationTags(detail).filter((t) => t.tone !== "blue" && t.label !== "AI answering");
  const icon = "size-4";

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ChatStyles />
      <section aria-label={`Chat with ${detail.visitorName}`} className={cn("sc-slide-in flex min-h-0 min-w-0 flex-1 flex-col bg-[#fafafb] lg:[animation:none] dark:bg-transparent", about && "max-xl:hidden")}>
        <header className="flex flex-col gap-2.5 border-b border-line bg-surface px-3 py-2.5 sm:px-5 sm:py-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={onBack} aria-label="Back to the chats" className="-ml-1 inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-0.5 rounded-full pl-1.5 pr-2.5 text-[13px] font-semibold text-ok hover:bg-soft lg:hidden">
              <ArrowLeft aria-hidden className="size-5" />
              <span className="max-sm:sr-only">Chats</span>
            </button>
            <Avatar name={detail.visitorName} className="size-10 text-[13px]" />
            <div className="flex min-w-0 flex-1 flex-col">
              <h1 className="truncate text-[16.5px] font-bold leading-tight">
                {detail.visitorName}
                {detail.businessName && <span className="font-medium text-muted"> · {detail.businessName}</span>}
              </h1>
              <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted">
                {detail.status === "WAITING" ? <LiveDot className="bg-danger" /> : <span aria-hidden className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[detail.status])} />}
                <span className="truncate">{statusLine(detail, me.name)}</span>
              </span>
            </div>
            <button type="button" onClick={() => setAbout(true)} aria-expanded={about} aria-label={`About ${detail.visitorName}`} className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-semibold hover:bg-soft xl:hidden">
              <Info aria-hidden className="size-4" />
              <span className="max-sm:sr-only">Info</span>
            </button>
          </div>
          <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-0.5 pt-0.5">
            {detail.status === "CLOSED" ? (
              <Action disabled={busy} icon={<RotateCcw aria-hidden className={icon} />} onClick={() => act(() => api.reopen(id), "Chat reopened.")}>Reopen</Action>
            ) : mine ? (
              <>
                <Action disabled={busy} icon={<Bot aria-hidden className={icon} />} onClick={() => act(() => api.release(id), "The AI answers this chat again.")}>Give back to AI</Action>
                <Action disabled={busy} icon={<ArrowRightLeft aria-hidden className={icon} />} onClick={() => setTransfer(true)}>Transfer</Action>
                <Action disabled={busy} tone="dark" icon={<CircleCheck aria-hidden className={icon} />} onClick={() => act(() => api.close(id), "Chat closed.")}>Close chat</Action>
              </>
            ) : (
              <>
                <Action disabled={busy} tone="primary" icon={<Hand aria-hidden className={icon} />} onClick={() => act(() => api.takeover(id), "You are in the chat. The AI stays quiet now.")}>
                  {detail.status === "WAITING" ? "Take this chat" : "Take over from the AI"}
                </Action>
                {me.role === "SUPERVISOR" && detail.status !== "AI" && <Action disabled={busy} icon={<ArrowRightLeft aria-hidden className={icon} />} onClick={() => setTransfer(true)}>Reassign</Action>}
              </>
            )}
            {tags.length > 0 && <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-line" />}
            <TagList tags={tags} className="flex-nowrap" />
          </div>
        </header>
        <div
          ref={scroller}
          onScroll={(e) => {
            const b = e.currentTarget;
            pinned.current = b.scrollHeight - b.scrollTop - b.clientHeight < 80;
          }}
          className="sc-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-4 sm:px-5"
          aria-live="polite"
        >
          {summary && (
            <details open className="group sc-fade rounded-[20px] bg-[linear-gradient(120deg,rgba(47,107,255,0.45),rgba(123,92,255,0.6))] p-px">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-t-[19px] bg-surface px-4 pb-1 pt-3 text-xs font-bold tracking-[0.04em] text-new group-[:not([open])]:rounded-b-[19px] group-[:not([open])]:pb-3 [&::-webkit-details-marker]:hidden">
                <span className="inline-flex size-6 items-center justify-center rounded-lg bg-brand-gradient text-white">
                  <Sparkles aria-hidden className="size-3.5" />
                </span>
                AI SUMMARY
                <span className="ml-auto text-[11px] font-medium tracking-normal text-muted group-open:hidden">Show</span>
                <span className="ml-auto hidden text-[11px] font-medium tracking-normal text-muted group-open:inline">Hide</span>
              </summary>
              <p className="rounded-b-[19px] bg-surface px-4 pb-3.5 pt-1 text-[14px] leading-normal">{summary}</p>
            </details>
          )}
          {detail.messages.map((m, i) => (
            <MessageBubble key={m.id} m={m} live={!!history && !history.has(m.id)} first={runs[i].first} last={runs[i].last} visitorName={detail.visitorName} />
          ))}
          {shownTyping && <TypingBubble who={shownTyping.who} name={detail.visitorName} draft={shownTyping.draft} />}
        </div>
        <Composer
          detail={detail}
          assist={assist}
          onSent={() => {
            pinned.current = true;
            reload();
          }}
        />
      </section>
      {about && (
        <section aria-label={`About ${detail.visitorName}`} className="sc-slide-in flex min-h-0 min-w-0 flex-1 flex-col bg-bg xl:hidden">
          <header className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2.5 sm:px-5">
            <button type="button" onClick={() => setAbout(false)} className="-ml-1 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-full pl-1.5 pr-3 text-[13px] font-semibold text-ok hover:bg-soft">
              <ArrowLeft aria-hidden className="size-5" /> Back to the chat
            </button>
            <span className="min-w-0 flex-1 truncate text-right text-[13px] text-muted">About {detail.visitorName}</span>
          </header>
          <div className="sc-scroll min-h-0 flex-1 overflow-y-auto">
            <ChatAside detail={detail} onOpenChat={onOpenChat} />
          </div>
        </section>
      )}
      <aside aria-label={`About ${detail.visitorName}`} className="sc-scroll hidden w-[340px] shrink-0 overflow-y-auto border-l border-line bg-bg xl:block">
        <ChatAside detail={detail} onOpenChat={onOpenChat} />
      </aside>
      <TransferDialog open={transfer} onClose={() => setTransfer(false)} detail={detail} onDone={(d) => { setDetail(d); toast("Chat transferred.", "success"); }} />
    </div>
  );
}
