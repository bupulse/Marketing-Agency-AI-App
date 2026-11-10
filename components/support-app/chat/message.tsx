"use client";

import { BookOpen, Check, CheckCheck, FileText, Info, Languages, Mic, MousePointerClick, Sparkles, StickyNote } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ConversationDetail } from "@/lib/support/contract";
import { initials } from "@/lib/support/app-client/lists";
import { avatarTone } from "./helpers";
import { Reveal } from "./reveal";
import { TypingDots, Shimmer } from "./styles";

type Message = ConversationDetail["messages"][number];

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The visitor's round avatar (their initials, a steady colour). */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex size-8 shrink-0 select-none items-center justify-center rounded-full text-[12px] font-bold", avatarTone(name), className)}>
      {initials(name)}
    </span>
  );
}

function Attachment({ m }: { m: Message }) {
  const a = m.attachment;
  if (!a) return null;
  return (
    <div className="w-[230px] max-w-full overflow-hidden rounded-[18px] border border-line bg-surface shadow-[0_6px_18px_-14px_rgba(17,24,39,0.5)]">
      {a.mime.startsWith("image/") && a.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={a.url} alt={a.fileName ?? "Picture from the visitor"} className="h-[130px] w-full object-cover" />
      ) : (
        <div className="flex h-[92px] items-center justify-center gap-2 bg-soft text-[12.5px] font-medium text-muted">
          <span className="inline-flex size-9 items-center justify-center rounded-xl bg-surface text-text shadow-sm">
            {m.kind === "VOICE" ? <Mic aria-hidden className="size-4" /> : <FileText aria-hidden className="size-4" />}
          </span>
          {m.kind === "VOICE" ? `Voice note${a.durationSec ? ` · ${a.durationSec} s` : ""}` : a.mime === "application/pdf" ? "PDF" : "Picture"}
        </div>
      )}
      <span className="block truncate px-3 py-2 text-[12.5px] text-muted">
        {a.url ? (
          <a href={a.url} target="_blank" rel="noreferrer" className="font-medium text-ok underline-offset-2 hover:underline">
            {a.fileName ?? "Open"}
          </a>
        ) : (
          (a.fileName ?? "File")
        )}
      </span>
      {a.transcript && <p className="border-t border-line px-3 py-2 text-[13px] leading-snug">“{a.transcript}”</p>}
    </div>
  );
}

/**
 * One message, with its own look: the visitor on the left (white bubble, their avatar), the AI on the right (violet,
 * a sparkle), an agent on the right (the brand gradient), an internal note (amber, dashed) and system events as a
 * quiet line in the middle. `live` messages arrived while the chat was open: they animate in, and an AI answer fades
 * in word by word. `first`/`last` place the name and the time once per run of messages.
 */
export function MessageBubble({ m, live, first, last, visitorName }: { m: Message; live: boolean; first: boolean; last: boolean; visitorName: string }) {
  if (m.kind === "EVENT" || m.author === "SYSTEM") {
    return (
      <div className={cn("my-1 flex items-center gap-3 self-stretch", live && "sc-fade")}>
        <span aria-hidden className="h-px flex-1 bg-line" />
        <p className="inline-flex max-w-[80%] items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-center text-[12px] font-medium text-muted">
          <Info aria-hidden className="size-3.5 shrink-0" />
          {m.body}
          <span className="text-muted/80">· {clock(m.createdAt)}</span>
        </p>
        <span aria-hidden className="h-px flex-1 bg-line" />
      </div>
    );
  }
  const visitor = m.author === "VISITOR";
  const note = m.kind === "NOTE";
  const ai = m.author === "AI" && !note;
  const agent = m.author === "AGENT" && !note;
  const who = note ? `Internal note${m.agentName ? ` · ${m.agentName}` : ""}` : visitor ? visitorName : ai ? "AI assistant" : (m.agentName ?? "Agent");
  const motion = !live ? null : visitor ? "sc-in-left" : ai ? "sc-rise" : "sc-pop";
  const seen = agent && m.seenByVisitorAt;

  return (
    <div className={cn("flex max-w-[88%] items-end gap-2 sm:max-w-[72%]", visitor ? "self-start" : "flex-row-reverse self-end", first ? "mt-2" : "-mt-1.5", motion)}>
      {visitor && (last ? <Avatar name={visitorName} /> : <span aria-hidden className="w-8 shrink-0" />)}
      <div className={cn("flex min-w-0 flex-col gap-1", visitor ? "items-start" : "items-end")}>
        {first && (
          <span className={cn("flex items-center gap-1 px-1 text-[11.5px] font-semibold", note ? "text-[#8a5a00] dark:text-[#ffc65c]" : ai ? "text-new" : "text-muted")}>
            {note && <StickyNote aria-hidden className="size-3.5" />}
            {ai && <Sparkles aria-hidden className="size-3.5" />}
            {who}
            {note && <span className="font-normal text-muted">· only the team sees this</span>}
          </span>
        )}
        <Attachment m={m} />
        {m.body && (
          <Reveal
            animate={live && ai}
            className={cn(
              "whitespace-pre-wrap break-words px-3.5 py-2.5 text-[14.5px] leading-[1.5]",
              note
                ? "rounded-[18px] border border-dashed border-[#d08700] bg-[#fff6e5] text-[#5c3b00] dark:bg-[#d08700]/15 dark:text-[#ffd99a]"
                : visitor
                  ? cn("rounded-[20px] border border-line bg-surface shadow-[0_4px_14px_-12px_rgba(17,24,39,0.45)] dark:bg-white/[0.07]", last && "rounded-bl-[6px]")
                  : ai
                    ? cn("rounded-[20px] border border-[#7b5cff]/20 bg-[#f4f0ff] dark:border-[#7b5cff]/30 dark:bg-[#7b5cff]/[0.16]", last && "rounded-br-[6px]")
                    : cn("rounded-[20px] bg-brand-gradient text-white shadow-[0_10px_24px_-16px_rgba(47,107,255,0.9)]", last && "rounded-br-[6px]"),
            )}
          >
            {m.body}
          </Reveal>
        )}
        {agent && m.original && m.original !== m.body && (
          <details className="max-w-full px-1 text-[11.5px] text-muted">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full hover:text-text [&::-webkit-details-marker]:hidden">
              <Languages aria-hidden className="size-3.5" /> Translated · see what you wrote
            </summary>
            <p className="sc-fade mt-1 whitespace-pre-wrap rounded-xl bg-soft px-2.5 py-1.5 text-[12.5px] text-text">{m.original}</p>
          </details>
        )}
        {ai && m.actions?.length ? (
          <span className="flex flex-wrap justify-end gap-1.5">
            {m.actions.map((a) => (
              <span key={a.label} title={`Button shown to the visitor: ${a.href}`} className="inline-flex items-center gap-1 rounded-full border border-[#7b5cff]/25 bg-surface px-2.5 py-1 text-[11.5px] font-medium text-new">
                <MousePointerClick aria-hidden className="size-3.5" /> {a.label}
              </span>
            ))}
          </span>
        ) : null}
        {m.sources?.length ? (
          <span className="flex max-w-full items-center gap-1 px-1 text-[11.5px] text-muted">
            <BookOpen aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">From the guide: {m.sources.map((s) => s.title).join(", ")}</span>
          </span>
        ) : null}
        {last && (
          <span className="flex items-center gap-1 px-1 text-[11px] tabular-nums text-muted">
            {clock(m.createdAt)}
            {agent && (seen ? <CheckCheck aria-label="Seen by the visitor" className="size-3.5 text-ok" /> : <Check aria-label="Sent" className="size-3.5" />)}
          </span>
        )}
      </div>
    </div>
  );
}

/** The visitor's live typing, with the sneak peek of what they are writing; or the AI writing its answer. */
export function TypingBubble({ who, name, draft }: { who: "visitor" | "ai"; name: string; draft: string }) {
  if (who === "ai") {
    return (
      <div role="status" className="sc-rise mt-2 flex items-center gap-2 self-end rounded-[20px] rounded-br-[6px] border border-[#7b5cff]/20 bg-[#f4f0ff] px-3.5 py-2.5 text-[13.5px] dark:border-[#7b5cff]/30 dark:bg-[#7b5cff]/[0.16]">
        <Sparkles aria-hidden className="size-4 text-new" />
        <Shimmer>The AI is writing an answer…</Shimmer>
      </div>
    );
  }
  return (
    <div role="status" className="sc-in-left mt-2 flex max-w-[88%] items-end gap-2 self-start sm:max-w-[72%]">
      <Avatar name={name} />
      <div className="flex min-w-0 flex-col items-start gap-1">
        <span className="px-1 text-[11.5px] font-semibold text-muted">{name} is typing</span>
        <div className="flex min-w-0 items-center gap-2.5 rounded-[20px] rounded-bl-[6px] border border-line bg-surface px-3.5 py-2.5 shadow-[0_4px_14px_-12px_rgba(17,24,39,0.45)] dark:bg-white/[0.07]">
          <TypingDots className="text-muted" />
          {draft ? (
            <span className="min-w-0 break-words text-[14px] italic text-muted">
              <span className="sr-only">Sneak peek: </span>“{draft}”
            </span>
          ) : (
            <span className="sr-only">{name} is typing</span>
          )}
        </div>
        {draft && <span className="px-1 text-[11px] text-muted">Sneak peek: not sent yet</span>}
      </div>
    </div>
  );
}
