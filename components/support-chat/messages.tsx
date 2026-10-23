"use client";

import { useEffect, useRef, useState } from "react";
import { COPY } from "@/lib/support/client/copy";
import type { Outgoing } from "@/lib/support/client/outbox";
import { formatBytes, formatDuration, waveform } from "@/lib/support/client/uploads";
import type { MessageView } from "@/lib/support/contract";
import { cn } from "@/lib/cn";
import { BookIcon, FileIcon, PauseIcon, PlayIcon } from "./icons";
import type { Typing } from "./use-support-chat";

const MINE = "self-end max-w-[78%] rounded-[18px_18px_6px_18px] bg-[linear-gradient(120deg,#2f6bff,#6a5cff)] px-3.5 py-2.5 text-white";
const THEIRS = "rounded-[18px_18px_18px_6px] border border-line bg-[var(--bp-bg-solid)] px-3.5 py-2.5";
export const CHIP = "cursor-pointer rounded-full border border-line bg-[var(--bp-bg-solid)] px-3 py-2 text-[13px] font-medium text-text transition-colors hover:bg-soft";

/** Only links inside BuPulse or to https sites; anything else in an AI action is dropped. */
const safeHref = (href: string | null | undefined) => (href && (/^\/(?!\/)/.test(href) || /^https:\/\//.test(href)) ? href : null);

type Attachment = { mime: string; fileName: string | null; bytes: number; url: string | null; durationSec: number | null; transcript: string | null };

function VoiceBubble({ id, a, mine }: { id: string; a: Attachment; mine: boolean }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const bars = waveform(id);
  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  };
  return (
    <div className={cn("flex flex-col gap-1", mine ? "items-end self-end" : "items-start self-start")}>
      <div className={cn("flex items-center gap-2.5 py-2 pr-3.5 pl-2", mine ? "rounded-[18px_18px_6px_18px] bg-[linear-gradient(120deg,#2f6bff,#6a5cff)] text-white" : THEIRS)}>
        <button
          type="button"
          onClick={toggle}
          disabled={!a.url}
          aria-label={playing ? COPY.pause : COPY.play}
          className={cn("inline-flex size-[30px] cursor-pointer items-center justify-center rounded-full", mine ? "bg-white/20" : "bg-soft text-ok")}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <svg width="96" height="22" viewBox="0 0 96 22" aria-hidden className={mine ? "text-white/90" : "text-muted"}>
          {bars.map((h, i) => (
            <line key={i} x1={3 + i * 6} x2={3 + i * 6} y1={11 - h * 9} y2={11 + h * 9} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          ))}
        </svg>
        <span className="text-xs font-semibold tabular-nums">{formatDuration(a.durationSec ?? 0)}</span>
        {a.url && <audio ref={audio} src={a.url} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />}
      </div>
      <p className="m-0 text-[11.5px] text-muted">
        {COPY.voiceNote}
        {a.transcript ? ` · “${a.transcript}”` : ""}
      </p>
    </div>
  );
}

function FileCard({ a, mine }: { a: Attachment; mine: boolean }) {
  const label = `${a.fileName ?? (a.mime === "application/pdf" ? "document.pdf" : "photo")} · ${formatBytes(a.bytes)}`;
  const image = a.mime.startsWith("image/");
  const card = (
    <>
      {image && a.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private signed or local URL, not for next/image
        <img src={a.url} alt={a.fileName ?? "Photo"} className="block h-24 w-full object-cover" />
      ) : (
        <span className="flex h-16 items-center justify-center bg-soft text-ok">
          <FileIcon />
        </span>
      )}
      <span className="block truncate px-2.5 py-1.5 text-xs text-muted">{label}</span>
    </>
  );
  const cls = cn("block w-[190px] overflow-hidden rounded-2xl border border-line bg-[var(--bp-bg-solid)] no-underline", mine ? "self-end" : "self-start");
  return a.url ? (
    <a href={a.url} target="_blank" rel="noopener noreferrer" className={cls} aria-label={`${COPY.openFile}: ${label}`}>
      {card}
    </a>
  ) : (
    <div className={cls}>{card}</div>
  );
}

function Body({ m }: { m: MessageView }) {
  const a = m.attachment;
  const mine = m.author === "VISITOR";
  return (
    <>
      {a && (a.mime.startsWith("audio/") ? <VoiceBubble id={m.id} a={a} mine={mine} /> : <FileCard a={a} mine={mine} />)}
      {m.body && (mine ? <p className={cn(MINE, "m-0 text-sm leading-[1.45] whitespace-pre-wrap")}>{m.body}</p> : <Theirs m={m} />)}
    </>
  );
}

function Theirs({ m }: { m: MessageView }) {
  const actions = (m.actions ?? []).map((x) => ({ ...x, href: safeHref(x.href) })).filter((x) => x.href);
  return (
    <div className={cn(THEIRS, "flex flex-col gap-2.5 text-sm leading-[1.45]")}>
      <span className="whitespace-pre-wrap">{m.body}</span>
      {actions.map((x) => (
        <a key={x.href! + x.label} href={x.href!} className="self-start rounded-full bg-soft px-3 py-2 text-[13px] font-semibold text-ok no-underline hover:underline">
          {x.label}
        </a>
      ))}
    </div>
  );
}

function AiLabel({ m }: { m: MessageView }) {
  const sources = m.sources ?? [];
  if (!sources.length) return <span className="text-[11.5px] text-muted">{COPY.ai}</span>;
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
      <BookIcon />
      <span>
        {COPY.fromGuide("")}
        {sources.map((s, i) => {
          const href = safeHref(s.href);
          return (
            <span key={s.title + i}>
              {i > 0 && " · "}
              {href ? (
                <a href={href} className="text-muted underline-offset-2 hover:underline">
                  {s.title}
                </a>
              ) : (
                s.title
              )}
            </span>
          );
        })}
      </span>
    </span>
  );
}

function Pending({ o, onRetry, onDiscard }: { o: Outgoing; onRetry: (id: string) => void; onDiscard: (id: string) => void }) {
  const a = o.attachment;
  const status = o.status === "failed" ? o.error ?? COPY.failed : o.status === "waiting" && o.tries > 0 ? COPY.queued : COPY.sending;
  return (
    <div className="flex flex-col items-end gap-1 self-end opacity-90">
      {a &&
        (a.kind === "voice" ? (
          <VoiceBubble id={o.clientMsgId} a={{ ...a, url: a.previewUrl, transcript: null }} mine />
        ) : (
          <FileCard a={{ ...a, url: a.previewUrl, transcript: null }} mine />
        ))}
      {o.text && <p className={cn(MINE, "m-0 max-w-full text-sm leading-[1.45] whitespace-pre-wrap")}>{o.text}</p>}
      {o.status === "failed" ? (
        <span className="flex gap-2 text-[11.5px]">
          <button type="button" onClick={() => onRetry(o.clientMsgId)} className="cursor-pointer text-danger underline">
            {status}
          </button>
          <button type="button" onClick={() => onDiscard(o.clientMsgId)} className="cursor-pointer text-muted underline" aria-label="Remove this message">
            Remove
          </button>
        </span>
      ) : (
        <span className="text-[11.5px] text-muted">{status}</span>
      )}
    </div>
  );
}

export function TypingLine({ who }: { who: string }) {
  return (
    <p className="m-0 flex items-center gap-1.5 text-xs text-muted">
      <span className="inline-flex gap-[3px]" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-[5px] animate-pulse rounded-full bg-muted/70 motion-reduce:animate-none" style={{ animationDelay: `${i * 0.2}s` }} />
        ))}
      </span>
      {who}
    </p>
  );
}

/** The conversation: what the server has, then what is still going out, then who is typing. */
export function MessageList({
  intro,
  messages,
  outgoing,
  typing,
  agentName,
  quickReplies,
  onRetry,
  onDiscard,
}: {
  intro: React.ReactNode;
  messages: MessageView[];
  outgoing: Outgoing[];
  typing: Typing;
  agentName: string | null;
  quickReplies: { label: string; onClick: () => void }[];
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const end = useRef<HTMLDivElement | null>(null);
  const shown = messages.filter((m) => m.kind !== "NOTE");
  // The server's copy of a message wins over ours as soon as it is there.
  const known = new Set(shown.map((m) => m.clientMsgId).filter(Boolean));
  const pending = outgoing.filter((o) => !known.has(o.clientMsgId));
  const count = shown.length + pending.length + (typing ? 1 : 0);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [count]);

  return (
    <div role="log" aria-live="polite" aria-relevant="additions" className="flex flex-col gap-2.5">
      {intro}
      {shown.map((m, i) => {
        if (m.kind === "EVENT" || m.author === "SYSTEM")
          return (
            <div key={m.id} className="my-1 flex items-center gap-2.5">
              <span className="h-px flex-1 bg-line" />
              <span className="text-center text-xs font-medium text-muted">{m.body}</span>
              <span className="h-px flex-1 bg-line" />
            </div>
          );
        if (m.author === "VISITOR")
          return (
            <div key={m.id} className="flex flex-col items-end gap-1.5">
              <Body m={m} />
            </div>
          );
        const next = shown[i + 1];
        const lastOfRun = !next || next.author !== m.author || next.agentName !== m.agentName;
        return (
          <div key={m.id} className="flex max-w-[86%] flex-col gap-1.5 self-start">
            <Body m={m} />
            {m.author === "AI" ? <AiLabel m={m} /> : lastOfRun && <span className="text-[11.5px] text-muted">{m.agentName ?? agentName ?? "BuPulse team"}</span>}
          </div>
        );
      })}
      {pending.map((o) => (
        <Pending key={o.clientMsgId} o={o} onRetry={onRetry} onDiscard={onDiscard} />
      ))}
      {typing && <TypingLine who={typing.who === "agent" ? COPY.typing(agentName?.split(" ")[0] ?? "The team") : COPY.aiTyping} />}
      {quickReplies.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-2">
          {quickReplies.map((q) => (
            <button key={q.label} type="button" onClick={q.onClick} className={CHIP}>
              {q.label}
            </button>
          ))}
        </div>
      )}
      <div ref={end} />
    </div>
  );
}
