"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, FileText, Info, Mic, Paperclip } from "lucide-react";
import { Button, Dialog, Field, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { conversationTopic, DEPARTMENT_KEYS, type Assist, type ConversationDetail, type DepartmentKey, type MessageView } from "@/lib/support/contract";
import type { TeamMember } from "@/lib/support/app-client/api";
import { DEPARTMENT_NAMES, conversationTags, languageName } from "@/lib/support/app-client/lists";
import { useSupportApp } from "./app-context";
import { ChatAside } from "./chat-aside";
import { TagList } from "./tags";
import { useLiveQuery } from "./use-live";

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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

function Bubble({ m }: { m: MessageView }) {
  if (m.kind === "EVENT" || m.author === "SYSTEM") return <p className="self-center rounded-full bg-black/[0.04] px-3 py-1 text-[12px] text-muted dark:bg-white/[0.06]">{m.body}</p>;
  const visitor = m.author === "VISITOR";
  const note = m.kind === "NOTE";
  const who = note ? `Internal note${m.agentName ? ` by ${m.agentName}` : ""} · the client can’t see this` : m.author === "AI" ? "AI" : m.author === "AGENT" ? (m.agentName ?? "Agent") : null;
  const a = m.attachment;
  return (
    <div className={cn("flex max-w-[85%] flex-col gap-1 sm:max-w-[70%]", visitor ? "items-start self-start" : "items-end self-end")}>
      {a ? (
        <div className="w-[220px] overflow-hidden rounded-[14px] border border-line bg-surface">
          {a.mime.startsWith("image/") && a.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.url} alt={a.fileName ?? "Picture from the visitor"} className="h-[120px] w-full object-cover" />
          ) : (
            <div className="flex h-[92px] items-center justify-center gap-2 bg-black/[0.04] text-[12px] text-muted dark:bg-white/[0.05]">
              {m.kind === "VOICE" ? <Mic aria-hidden className="size-4" /> : <FileText aria-hidden className="size-4" />}
              {m.kind === "VOICE" ? `Voice note${a.durationSec ? ` · ${a.durationSec} s` : ""}` : a.mime === "application/pdf" ? "PDF" : "Picture"}
            </div>
          )}
          <span className="block px-2.5 py-1.5 text-[12px] text-muted">{a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="underline">{a.fileName ?? "Open"}</a> : (a.fileName ?? "File")}</span>
          {a.transcript && <p className="border-t border-line px-2.5 py-1.5 text-[13px]">“{a.transcript}”</p>}
        </div>
      ) : null}
      {m.body && (
        <p
          className={cn(
            "whitespace-pre-wrap break-words px-3.5 py-2.5 text-sm leading-[1.45]",
            note
              ? "rounded-[14px] border border-dashed border-[#d08700] bg-[#fff4e0] text-[#5c3b00] dark:bg-[#d08700]/15 dark:text-[#ffd99a]"
              : visitor
                ? "rounded-[18px_18px_18px_6px] border border-line bg-surface dark:bg-white/[0.06]"
                : "rounded-[18px_18px_6px_18px] bg-[#eef0f6] dark:bg-[#2f6bff]/20",
          )}
        >
          {m.body}
        </p>
      )}
      <span className="text-[11.5px] text-muted">
        {who ? `${who} · ` : ""}
        {clock(m.createdAt)}
      </span>
      {m.sources?.length ? <span className="text-[11.5px] text-muted">From the guide: {m.sources.map((s) => s.title).join(", ")}</span> : null}
    </div>
  );
}

function TransferDialog({ open, onClose, detail, onDone }: { open: boolean; onClose: () => void; detail: ConversationDetail; onDone: (d: ConversationDetail) => void }) {
  const { api, me, fail } = useSupportApp();
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [to, setTo] = useState<"agent" | "department">("agent");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (open && !team) api.team().then((r) => setTeam(r.agents.filter((a) => a.id !== me.id)), (e) => setError(fail(e)));
  }, [open, team, api, me.id, fail]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Transfer this chat" description="To a colleague, or to a department's queue. Your note is internal: the client can’t see it.">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const note = String(f.get("note") ?? "").trim() || undefined;
          setPending(true);
          try {
            const d = await api.assign(detail.id, to === "agent" ? { agentId: String(f.get("agentId")), note } : { department: String(f.get("department")) as DepartmentKey, note });
            onDone(d);
            onClose();
          } catch (err) {
            setError(fail(err));
          } finally {
            setPending(false);
          }
        }}
      >
        <fieldset className="flex gap-4 text-sm">
          <legend className="sr-only">Transfer to</legend>
          <label className="flex min-h-11 items-center gap-2"><input type="radio" checked={to === "agent"} onChange={() => setTo("agent")} /> A colleague</label>
          <label className="flex min-h-11 items-center gap-2"><input type="radio" checked={to === "department"} onChange={() => setTo("department")} /> A department</label>
        </fieldset>
        {to === "agent" ? (
          <Field label="Colleague">
            <Select name="agentId" required defaultValue="">
              <option value="" disabled>{team ? (team.length ? "Choose…" : "Nobody else yet") : "Loading…"}</option>
              {team?.map((a) => (
                <option key={a.id} value={a.id} disabled={a.availability === "offline"}>
                  {a.name} · {a.availability} · {a.openChats}/{a.maxChats} chats
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Department">
            <Select name="department" required defaultValue={detail.department ?? "sales"}>
              {DEPARTMENT_KEYS.map((k) => <option key={k} value={k}>{DEPARTMENT_NAMES[k]}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Note for them (optional)">
          <Textarea name="note" rows={2} maxLength={500} placeholder="What they should know" />
        </Field>
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={pending}>{pending ? "Transferring…" : "Transfer"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function Composer({ detail, assist, onSent }: { detail: ConversationDetail; assist: Assist | null; onSent: () => void }) {
  const { api, fail } = useSupportApp();
  const { toast } = useToast();
  const [mode, setMode] = useState<"TEXT" | "NOTE">("TEXT");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [translate, setTranslate] = useState(true);
  const lastTyping = useRef(0);
  const lang = detail.language && detail.language !== "en" ? detail.language : null;
  const closed = detail.status === "CLOSED";

  async function rewrite(style: "friendlier" | "shorter" | "translate") {
    if (!text.trim()) return toast("Write a reply first.", "info");
    setBusy(style);
    try {
      setText((await api.rewrite({ text, style, lang: style === "translate" ? (lang ?? undefined) : undefined })).text);
    } catch (e) {
      toast(fail(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy("send");
    try {
      await api.send(detail.id, { text: body, kind: mode, clientMsgId: crypto.randomUUID(), translateTo: mode === "TEXT" && lang && translate ? lang : undefined });
      setText("");
      onSent();
    } catch (e) {
      toast(fail(e), "error");
    } finally {
      setBusy(null);
    }
  }

  if (closed) return <p className="border-t border-line bg-surface px-5 py-4 text-sm text-muted">This chat is closed. Reopen it to reply.</p>;
  return (
    <div className="flex flex-col gap-2.5 border-t border-line bg-surface px-4 pb-4 pt-3 max-lg:sticky max-lg:bottom-0 max-lg:z-10 sm:px-5">
      {mode === "TEXT" && assist?.suggestions.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-new">Suggested</span>
          {assist.suggestions.slice(0, 3).map((s) => (
            <button key={s} type="button" onClick={() => setText(s)} className="cursor-pointer rounded-full border border-[#7b5cff]/30 bg-[#7b5cff]/8 px-3 py-1.5 text-left text-[13px] hover:bg-[#7b5cff]/14">
              {s}
            </button>
          ))}
        </div>
      ) : null}
      <div role="tablist" aria-label="Reply or note" className="flex gap-4 text-[13px] font-semibold">
        {(["TEXT", "NOTE"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn("min-h-9 cursor-pointer border-b-2 pb-1", mode === m ? "border-pulse-blue text-text" : "border-transparent text-muted")}>
            {m === "TEXT" ? "Reply" : "Internal note"}
          </button>
        ))}
      </div>
      <label className="flex flex-col">
        <span className="sr-only">{mode === "TEXT" ? `Reply to ${detail.visitorName}` : "Internal note"}</span>
        <textarea
          rows={2}
          value={text}
          maxLength={2000}
          onChange={(e) => {
            setText(e.target.value);
            if (mode === "TEXT" && Date.now() - lastTyping.current > 3000) {
              lastTyping.current = Date.now();
              void api.typing(detail.id).catch(() => undefined);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={mode === "TEXT" ? "Type a reply, or / for shortcuts" : "A note for the team (the client can’t see it)"}
          className={cn("w-full resize-none rounded-[14px] border px-3.5 py-3 text-[15px] outline-none focus:shadow-ring", mode === "NOTE" ? "border-dashed border-[#d08700] bg-[#fff4e0]/60 dark:bg-[#d08700]/10" : "border-line bg-transparent")}
        />
      </label>
      {text.startsWith("/") && <p role="status" className="rounded-xl bg-soft px-3 py-2 text-[13px] text-muted">Shortcuts (saved replies you insert with /) are coming soon.</p>}
      <div className="flex flex-wrap items-center gap-2">
        {mode === "TEXT" && (
          <>
            {lang && <Button size="sm" variant="outline" className="min-h-9 px-3 text-[13px] font-medium" disabled={!!busy} onClick={() => rewrite("translate")}>{busy === "translate" ? "Translating…" : `Translate to ${languageName(lang)}`}</Button>}
            <Button size="sm" variant="outline" className="min-h-9 px-3 text-[13px] font-medium" disabled={!!busy} onClick={() => rewrite("friendlier")}>{busy === "friendlier" ? "Rewriting…" : "Friendlier"}</Button>
            <Button size="sm" variant="outline" className="min-h-9 px-3 text-[13px] font-medium" disabled={!!busy} onClick={() => rewrite("shorter")}>{busy === "shorter" ? "Rewriting…" : "Shorter"}</Button>
          </>
        )}
        <button type="button" aria-label="Attach a file" title="Attach a file" onClick={() => toast("Sending files from the support app is coming soon. Ask the client to send theirs in the chat.", "info")} className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full border border-line text-muted hover:bg-soft">
          <Paperclip aria-hidden className="size-4" />
        </button>
        {mode === "TEXT" && lang && (
          <label className="flex items-center gap-1.5 text-[13px] text-muted">
            <input type="checkbox" checked={translate} onChange={(e) => setTranslate(e.target.checked)} /> Send in {languageName(lang)}
          </label>
        )}
        <span className="flex-1" />
        <Button size="sm" className="min-h-10 px-5" disabled={!text.trim() || !!busy} onClick={send}>
          {busy === "send" ? "Sending…" : mode === "TEXT" ? "Send" : "Add note"}
        </Button>
      </div>
    </div>
  );
}

/** One chat: the summary, the messages, the reply box and the actions; the facts beside it (below a button on phones). */
export function Conversation({ id, onBack, onOpenChat }: { id: string; onBack: () => void; onOpenChat: (id: string) => void }) {
  const { api, me, hub, fail } = useSupportApp();
  const { toast } = useToast();
  const { data, error, reload } = useLiveQuery(() => api.conversation(id), { topics: [conversationTopic(id)], key: id, match: (e) => e.type !== "typing" });
  // An action's answer shows at once and stays until the next load brings the chat again.
  const [local, setLocal] = useState<{ from: ConversationDetail | null; value: ConversationDetail } | null>(null);
  const detail = local && local.from === data ? local.value : data;
  const setDetail = (value: ConversationDetail) => setLocal({ from: data, value });
  const [assist, setAssist] = useState<Assist | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [about, setAbout] = useState(false);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const lastId = detail?.messages.at(-1)?.id;
  useEffect(() => {
    if (!lastId) return;
    let stop = false;
    api.assist(id).then((a) => !stop && setAssist(a), () => undefined);
    return () => {
      stop = true;
    };
  }, [api, id, lastId]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lastId]);
  useEffect(() => {
    let clear: ReturnType<typeof setTimeout> | null = null;
    const off = hub.subscribe([conversationTopic(id)], (e) => {
      if (e.type !== "typing" || e.who !== "visitor") return;
      setTyping(e.draft ?? "");
      if (clear) clearTimeout(clear);
      clear = setTimeout(() => setTyping(null), 6000);
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
      <section aria-label="Chat" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted">
        {error ? <p role="alert">{error}</p> : <p>Loading the chat…</p>}
        <Button variant="outline" size="sm" className="lg:hidden" onClick={onBack} leading={<ArrowLeft aria-hidden className="size-4" />}>All chats</Button>
      </section>
    );
  }
  const mine = detail.assigneeName === me.name && detail.status === "OPEN";
  const title = detail.businessName ? `${detail.visitorName} · ${detail.businessName}` : detail.visitorName;
  const summary = detail.summary ?? assist?.summary ?? null;
  const pill = "min-h-10 rounded-full px-3.5 text-[13px]";

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <section aria-label={`Chat with ${detail.visitorName}`} className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#fafafb] dark:bg-transparent">
        <header className="flex flex-wrap items-center gap-2.5 border-b border-line bg-surface px-4 py-3 sm:px-5">
          <button type="button" onClick={onBack} aria-label="Back to the chats" className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-soft lg:hidden">
            <ArrowLeft aria-hidden className="size-5" />
          </button>
          <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
            <h1 className="truncate text-[17px] font-bold">{title}</h1>
            <span className="text-[13px] text-muted">{statusLine(detail, me.name)}</span>
            <TagList tags={conversationTags(detail).filter((t) => t.tone !== "blue" && t.label !== "AI answering")} className="pt-1" />
          </div>
          <button type="button" onClick={() => setAbout((v) => !v)} aria-expanded={about} aria-label={`About ${detail.visitorName}`} className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-soft xl:hidden">
            <Info aria-hidden className="size-5" />
          </button>
          <div className="flex flex-wrap gap-2">
            {detail.status === "CLOSED" ? (
              <Button size="sm" variant="outline" className={pill} disabled={busy} onClick={() => act(() => api.reopen(id), "Chat reopened.")}>Reopen</Button>
            ) : mine ? (
              <>
                <Button size="sm" variant="outline" className={pill} disabled={busy} onClick={() => act(() => api.release(id), "The AI answers this chat again.")}>Give back to AI</Button>
                <Button size="sm" variant="outline" className={pill} disabled={busy} onClick={() => setTransfer(true)}>Transfer</Button>
                <Button size="sm" variant="white" className={cn(pill, "border-0 bg-graphite text-white dark:bg-white dark:text-graphite")} disabled={busy} onClick={() => act(() => api.close(id), "Chat closed.")}>Close chat</Button>
              </>
            ) : (
              <>
                {me.role === "SUPERVISOR" && detail.status !== "AI" && <Button size="sm" variant="outline" className={pill} disabled={busy} onClick={() => setTransfer(true)}>Reassign</Button>}
                <Button size="sm" className={pill} disabled={busy} onClick={() => act(() => api.takeover(id), "You are in the chat. The AI stays quiet now.")}>{detail.status === "WAITING" ? "Take this chat" : "Take over from the AI"}</Button>
              </>
            )}
          </div>
        </header>
        {about && (
          <div className="border-b border-line bg-surface xl:hidden">
            <ChatAside detail={detail} onOpenChat={onOpenChat} />
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-5" aria-live="polite">
          {summary && (
            <div className="flex flex-col gap-1.5 rounded-[18px] border-2 border-[#7b5cff]/45 bg-surface px-4 py-3.5">
              <span className="text-xs font-bold tracking-[0.02em] text-new">AI SUMMARY</span>
              <p className="text-sm leading-normal">{summary}</p>
            </div>
          )}
          {detail.messages.map((m) => <Bubble key={m.id} m={m} />)}
          {typing !== null && <p className="self-start text-[13px] italic text-muted">{detail.visitorName} is typing{typing ? `: “${typing}”` : "…"}</p>}
          <div ref={end} />
        </div>
        <Composer detail={detail} assist={assist} onSent={reload} />
      </section>
      <aside aria-label={`About ${detail.visitorName}`} className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-line bg-surface xl:block">
        <ChatAside detail={detail} onOpenChat={onOpenChat} />
      </aside>
      <TransferDialog open={transfer} onClose={() => setTransfer(false)} detail={detail} onDone={(d) => { setDetail(d); toast("Chat transferred.", "success"); }} />
    </div>
  );
}
