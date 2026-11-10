"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Languages, Lock, MessageSquareText, Paperclip, Scissors, Smile, Sparkles, StickyNote } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import type { Assist, ConversationDetail } from "@/lib/support/contract";
import { languageName } from "@/lib/support/app-client/lists";
import { useSupportApp } from "../app-context";
import { Shimmer } from "./styles";

const chip = "inline-flex min-h-9 shrink-0 cursor-pointer whitespace-nowrap items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-[background-color,border-color,transform] duration-200 hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none";

/**
 * The reply box: Reply or Internal note, the AI's suggested replies, Translate / Friendlier / Shorter, attach, "Send in
 * <language>", and a round send button. It grows with the text; Enter sends, Shift+Enter makes a new line. Typing pings
 * the visitor's "agent is typing" at most every 3 s.
 */
export function Composer({ detail, assist, onSent }: { detail: ConversationDetail; assist: Assist | null; onSent: () => void }) {
  const { api, fail } = useSupportApp();
  const { toast } = useToast();
  const [mode, setMode] = useState<"TEXT" | "NOTE">("TEXT");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [translate, setTranslate] = useState(true);
  const lastTyping = useRef(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const lang = detail.language && detail.language !== "en" ? detail.language : null;
  const closed = detail.status === "CLOSED";

  // Grow with the text, up to about seven lines.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text, mode]);

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
      area.current?.focus();
    }
  }

  if (closed) {
    return (
      <div className="border-t border-line bg-surface px-4 py-4 sm:px-5">
        <p className="flex items-center gap-2.5 rounded-2xl border border-dashed border-line bg-soft px-4 py-3 text-sm text-muted">
          <Lock aria-hidden className="size-4 shrink-0" /> This chat is closed. Reopen it (top right) to reply.
        </p>
      </div>
    );
  }
  const note = mode === "NOTE";
  const ready = !!text.trim() && !busy;
  const working = busy && busy !== "send" ? (busy === "translate" ? "Translating…" : "Rewriting…") : null;

  return (
    <div className="flex flex-col gap-2.5 border-t border-line bg-surface/95 px-3 pb-3 pt-2.5 sm:px-5 sm:pb-4">
      {!note && assist?.suggestions.length ? (
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1 text-[11.5px] font-bold tracking-[0.03em] text-new">
            <Sparkles aria-hidden className="size-3.5" /> SUGGESTED REPLIES · tap to use
          </span>
          <div className="sc-stagger -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {assist.suggestions.slice(0, 3).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setText(s);
                  area.current?.focus();
                }}
                className="max-w-[300px] shrink-0 cursor-pointer truncate rounded-2xl border border-[#7b5cff]/30 bg-[#7b5cff]/[0.07] px-3 py-2 text-left text-[13px] transition-[background-color,transform] duration-200 hover:-translate-y-px hover:bg-[#7b5cff]/[0.14] motion-reduce:transform-none"
                title={s}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          "rounded-[22px] border shadow-[0_8px_24px_-18px_rgba(17,24,39,0.5)] transition-[border-color,box-shadow,background-color] duration-200 focus-within:shadow-[0_12px_32px_-18px_rgba(47,107,255,0.6)] motion-reduce:transition-none",
          note ? "border-dashed border-[#d08700] bg-[#fff6e5] focus-within:border-[#d08700] dark:bg-[#d08700]/10" : "border-line bg-surface focus-within:border-pulse-blue/50 dark:bg-white/[0.04]",
        )}
      >
        <label className="flex flex-col">
          <span className="sr-only">{note ? "Internal note" : `Reply to ${detail.visitorName}`}</span>
          <textarea
            ref={area}
            rows={1}
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
            placeholder={note ? "A note for the team (the client can’t see it)" : "Type a reply, or / for shortcuts"}
            className="block max-h-[180px] min-h-[44px] w-full resize-none bg-transparent px-4 pb-1 pt-3 text-[15px] leading-[1.45] outline-none placeholder:text-muted"
            style={{ outline: "none" }}
          />
        </label>
        <div className="flex items-center gap-1.5 px-2 pb-2">
          <div role="tablist" aria-label="Reply or note" className="inline-flex shrink-0 rounded-full bg-soft p-0.5">
            {(["TEXT", "NOTE"] as const).map((m) => {
              const on = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => {
                    setMode(m);
                    area.current?.focus();
                  }}
                  className={cn(
                    "inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold transition-[background-color,color,box-shadow] duration-200",
                    on ? (m === "NOTE" ? "bg-[#d08700] text-white shadow-sm" : "bg-surface text-text shadow-[0_1px_3px_rgba(0,0,0,0.12)] dark:bg-white/15") : "text-muted hover:text-text",
                  )}
                >
                  {m === "TEXT" ? <MessageSquareText aria-hidden className="size-3.5" /> : <StickyNote aria-hidden className="size-3.5" />}
                  {m === "TEXT" ? "Reply" : "Internal note"}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            aria-label="Attach a file"
            title="Attach a file"
            onClick={() => toast("Sending files from the support app is coming soon. Ask the client to send theirs in the chat.", "info")}
            className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-soft hover:text-text"
          >
            <Paperclip aria-hidden className="size-[18px]" />
          </button>
          <span className="min-w-0 flex-1 truncate px-1 text-[11.5px] text-muted">
            {working ? <Shimmer>{working}</Shimmer> : note ? "The client can’t see notes" : lang && translate ? `Goes out in ${languageName(lang)}` : <span className="max-md:hidden" title="Shift+Enter for a new line">Enter to send</span>}
          </span>
          {text.length > 1600 && <span className="sc-fade shrink-0 text-[11px] tabular-nums text-muted">{text.length}/2000</span>}
          <button
            type="button"
            onClick={send}
            disabled={!ready}
            data-ready={ready}
            aria-label={busy === "send" ? "Sending" : note ? "Add note" : "Send"}
            title={note ? "Add note" : "Send"}
            className={cn(
              "sc-send inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold text-white disabled:cursor-default",
              ready ? (note ? "bg-[#d08700] shadow-[0_8px_20px_-10px_rgba(208,135,0,0.9)]" : "bg-brand-gradient shadow-[0_8px_20px_-10px_rgba(47,107,255,0.9)]") : "bg-black/10 text-muted dark:bg-white/10",
            )}
          >
            {busy === "send" ? <span aria-hidden className="sc-spin size-4 rounded-full border-2 border-white/40 border-t-white" /> : <ArrowUp aria-hidden className="size-4" strokeWidth={2.6} />}
            <span className="hidden sm:inline">{busy === "send" ? "Sending…" : note ? "Add note" : "Send"}</span>
          </button>
        </div>
      </div>

      {text.startsWith("/") && <p role="status" className="sc-fade rounded-xl bg-soft px-3 py-2 text-[13px] text-muted">Shortcuts (saved replies you insert with /) are coming soon.</p>}

      {!note && (
        <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-0.5" aria-label="Quick tools">
          {lang && (
            <button type="button" className={cn(chip, "border-line bg-surface hover:bg-soft")} disabled={!!busy} onClick={() => rewrite("translate")}>
              <Languages aria-hidden className="size-4" />
              {busy === "translate" ? "Translating…" : `Translate to ${languageName(lang)}`}
            </button>
          )}
          <button type="button" className={cn(chip, "border-line bg-surface hover:bg-soft")} disabled={!!busy} onClick={() => rewrite("friendlier")}>
            <Smile aria-hidden className="size-4" />
            {busy === "friendlier" ? "Rewriting…" : "Friendlier"}
          </button>
          <button type="button" className={cn(chip, "border-line bg-surface hover:bg-soft")} disabled={!!busy} onClick={() => rewrite("shorter")}>
            <Scissors aria-hidden className="size-4" />
            {busy === "shorter" ? "Rewriting…" : "Shorter"}
          </button>
          {lang && (
            <button
              type="button"
              aria-pressed={translate}
              onClick={() => setTranslate((v) => !v)}
              className={cn(chip, "shrink-0", translate ? "border-pulse-blue bg-pulse-blue/[0.08] text-ok dark:bg-pulse-blue/15" : "border-line bg-surface text-muted hover:bg-soft")}
            >
              <span aria-hidden className={cn("inline-flex size-4 items-center justify-center rounded-full border text-[10px]", translate ? "border-transparent bg-pulse-blue text-white" : "border-line")}>{translate ? "✓" : ""}</span>
              Send in {languageName(lang)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
