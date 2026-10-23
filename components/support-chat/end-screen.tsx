"use client";

import { useState } from "react";
import { COPY } from "@/lib/support/client/copy";
import { cn } from "@/lib/cn";
import { ThumbDownIcon, ThumbUpIcon, WhatsAppIcon } from "./icons";

/** The end of a chat: thumbs up or down, a comment, an emailed copy, WhatsApp, and a new chat. */
export function EndScreen({
  agentName,
  email,
  whatsappHref,
  canRate,
  onRate,
  onNewChat,
}: {
  agentName: string | null;
  email: string | null;
  whatsappHref: string | null;
  /** Nothing to rate when the chat never started. */
  canRate: boolean;
  onRate: (score: 1 | -1, comment: string, sendTranscript: boolean) => Promise<void>;
  onNewChat: () => void;
}) {
  const [score, setScore] = useState<1 | -1 | null>(null);
  const [comment, setComment] = useState("");
  const [copy, setCopy] = useState(!!email);
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">("idle");
  const thumb = (value: 1 | -1) =>
    cn(
      "inline-flex size-[72px] cursor-pointer items-center justify-center rounded-[22px] transition-colors",
      score === value ? "border-2 border-pulse-blue bg-soft text-ok" : "border border-line bg-[var(--bp-bg-solid)] text-muted hover:bg-soft",
    );

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-auto bg-black/[0.02] px-5 py-6 dark:bg-white/[0.03]">
      {canRate && state !== "done" && (
        <form
          className="flex flex-col gap-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (score === null) return;
            setState("busy");
            try {
              await onRate(score, comment, copy && !!email);
              setState("done");
            } catch {
              setState("failed");
            }
          }}
        >
          <div className="flex flex-col items-center gap-1.5 text-center">
            <h2 className="m-0 text-xl font-bold tracking-[-0.02em]">{COPY.endTitle}</h2>
            <p className="m-0 text-sm text-muted">{COPY.endSub(agentName?.split(" ")[0] ?? null)}</p>
          </div>
          <div role="group" aria-label={COPY.rateGroup} className="flex justify-center gap-4">
            <button type="button" aria-pressed={score === 1} aria-label={COPY.good} onClick={() => setScore(1)} className={thumb(1)}>
              <ThumbUpIcon />
            </button>
            <button type="button" aria-pressed={score === -1} aria-label={COPY.notGood} onClick={() => setScore(-1)} className={thumb(-1)}>
              <ThumbDownIcon />
            </button>
          </div>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
            <span>
              {COPY.comment} <span className="font-normal text-muted">{COPY.optional}</span>
            </span>
            <textarea
              rows={3}
              maxLength={1000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="resize-none rounded-field border border-line bg-transparent px-3.5 py-3 text-[15px] font-normal text-text outline-none focus:border-pulse-blue focus:shadow-ring"
            />
          </label>
          {email && (
            <label className="flex items-start gap-2.5 text-sm leading-[1.4]">
              <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} className="m-0 size-5 flex-none accent-pulse-blue" />
              <span>
                {COPY.emailCopy} <strong>{email}</strong>
              </span>
            </label>
          )}
          {state === "failed" && (
            <p role="alert" className="m-0 text-sm text-danger">
              {COPY.somethingWrong}
            </p>
          )}
          <button type="submit" disabled={score === null || state === "busy"} className="min-h-12 cursor-pointer rounded-full border-0 bg-brand-gradient px-4 text-base font-semibold text-white shadow-glow disabled:cursor-not-allowed disabled:opacity-50">
            {state === "busy" ? COPY.sending : COPY.send}
          </button>
        </form>
      )}
      {state === "done" && (
        <p role="status" className="m-0 text-center text-base font-semibold">
          {COPY.thanks}
        </p>
      )}
      <div className="flex flex-col items-center gap-2.5">
        {whatsappHref && (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-success/35 bg-success-bg px-3.5 py-2.5 text-sm font-semibold text-success no-underline"
          >
            <WhatsAppIcon />
            {COPY.whatsapp}
          </a>
        )}
        <button type="button" onClick={onNewChat} className="cursor-pointer text-sm text-[color:var(--bp-link)] underline">
          {COPY.newChat}
        </button>
      </div>
    </div>
  );
}
