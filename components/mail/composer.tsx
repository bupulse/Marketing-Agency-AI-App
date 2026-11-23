"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Maximize2, Minus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { sendMailAction } from "@/app/mail/(app)/actions";
import { useMail } from "./shell";

export type ComposeInit = {
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  text?: string;
  parentId?: string | null;
  mode?: "new" | "reply" | "all" | "forward";
  /** The earlier message, shown hidden behind ··· (it is added by the server when sending). */
  quote?: string;
};

export function Composer({ init, onClose, inline = false }: { init: ComposeInit; onClose: () => void; inline?: boolean }) {
  const { data, toastUndo } = useMail();
  const router = useRouter();
  const [from, setFrom] = useState(init.from && data.sendFrom.some((s) => s.id === init.from) ? init.from : data.sendFrom[0]?.id ?? "");
  const [to, setTo] = useState(init.to ?? "");
  const [cc, setCc] = useState(init.cc ?? "");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(!!init.cc);
  const [subject, setSubject] = useState(init.subject ?? "");
  const [text, setText] = useState(init.text ?? "");
  const [showQuote, setShowQuote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [min, setMin] = useState(false);
  const [big, setBig] = useState(false);
  const [pending, start] = useTransition();
  const body = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    (init.mode === "reply" || init.mode === "all" ? body.current : null)?.focus();
  }, [init.mode]);

  const send = () =>
    start(async () => {
      setError(null);
      const r = await sendMailAction({ from, to, cc, bcc, subject, text, parentId: init.parentId ?? null, mode: init.mode ?? "new" });
      if (!r.ok) return setError(r.error);
      onClose();
      toastUndo(r.messageId, r.undoSeconds);
      router.refresh();
    });

  const field = "flex min-h-[46px] items-center gap-3 border-b border-black/[0.08] px-5 text-[14.5px] dark:border-white/10";
  const input = "min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted";
  const title = init.mode === "reply" ? "Reply" : init.mode === "all" ? "Reply all" : init.mode === "forward" ? "Forward" : "New message";

  return (
    <section
      aria-label={title}
      onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } }}
      className={cn(
        "bmail-pop flex flex-col overflow-hidden border border-white/90 bg-white/95 text-text shadow-[0_30px_80px_-30px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#1c1c22]/95",
        inline ? "rounded-[18px]" : big ? "fixed inset-4 z-50 rounded-[22px] md:inset-x-[10%] md:inset-y-8" : "fixed bottom-0 right-4 z-50 w-[min(640px,calc(100vw-2rem))] rounded-t-[18px] max-md:inset-x-0 max-md:right-0 max-md:w-full",
      )}
    >
      <header className="flex items-center gap-1 bg-[#f2f4fa] py-2 pl-5 pr-2 dark:bg-white/5">
        <h2 className="flex-1 text-[14.5px] font-semibold">{title}</h2>
        {!inline && <button type="button" aria-label="Minimise" onClick={() => setMin((v) => !v)} className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full hover:bg-black/5"><Minus className="size-4" /></button>}
        {!inline && <button type="button" aria-label="Full screen" onClick={() => setBig((v) => !v)} className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full hover:bg-black/5"><Maximize2 className="size-4" /></button>}
        <button type="button" aria-label="Close" onClick={onClose} className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full hover:bg-black/5"><X className="size-4" /></button>
      </header>
      {!min && (
        <>
          <label className={field}><span className="w-14 text-muted">From</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)} className={cn(input, "cursor-pointer font-medium")}>
              {data.sendFrom.map((s) => <option key={s.id} value={s.id}>{s.label} &lt;{s.address}&gt;</option>)}
            </select>
          </label>
          <div className={field}>
            <label htmlFor="c-to" className="w-14 text-muted">To</label>
            <input id="c-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com, another@example.com" className={input} autoFocus={!init.mode || init.mode === "new" || init.mode === "forward"} />
            {!showCc && <button type="button" onClick={() => setShowCc(true)} className="cursor-pointer text-[13.5px] text-[#1f5ae6]">Cc Bcc</button>}
          </div>
          {showCc && (
            <>
              <div className={field}><label htmlFor="c-cc" className="w-14 text-muted">Cc</label><input id="c-cc" value={cc} onChange={(e) => setCc(e.target.value)} className={input} /></div>
              <div className={field}><label htmlFor="c-bcc" className="w-14 text-muted">Bcc</label><input id="c-bcc" value={bcc} onChange={(e) => setBcc(e.target.value)} className={input} /></div>
            </>
          )}
          <div className={field}><label htmlFor="c-sub" className="w-14 text-muted">Subject</label><input id="c-sub" value={subject} onChange={(e) => setSubject(e.target.value)} className={cn(input, "font-medium")} /></div>
          <div className={cn("flex flex-col overflow-y-auto", big ? "flex-1" : "max-h-[52vh]")}>
            <label htmlFor="c-body" className="sr-only">Message</label>
            <textarea id="c-body" ref={body} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write your message" className={cn("w-full resize-none bg-transparent px-5 pt-4 text-[15px] leading-relaxed outline-none", big ? "min-h-[40vh]" : "min-h-[180px]")} />
            <div aria-label="Your signature" className="mx-5 mb-2 mt-1 border-t border-dashed border-black/15 pt-3 text-[13px] dark:border-white/15" dangerouslySetInnerHTML={{ __html: data.signatureHtml }} />
            {init.quote && (
              <div className="px-5 pb-3">
                <button type="button" onClick={() => setShowQuote((v) => !v)} aria-expanded={showQuote} aria-label={showQuote ? "Hide the earlier message" : "Show the earlier message"} className="inline-flex h-[18px] w-[34px] cursor-pointer items-center justify-center rounded-md bg-[#e8eaef] text-[14px] font-extrabold leading-none tracking-[1px] text-[#3c3c43] hover:bg-[#dcdfe6]">···</button>
                {showQuote && <pre className="bmail-rise mt-3 whitespace-pre-wrap border-l-2 border-[#d1d5db] pl-3 font-sans text-[14px] leading-relaxed text-[#3c3c43] dark:text-white/70">{init.quote}</pre>}
              </div>
            )}
          </div>
          {error && <p role="alert" className="mx-5 mb-2 rounded-xl bg-[#fdecec] px-4 py-2.5 text-[13.5px] font-medium text-[#b42318]">{error}</p>}
          <footer className="flex items-center gap-2 border-t border-black/[0.08] bg-[#fbfbfd] px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
            <button type="button" disabled={pending} onClick={send} className="h-11 cursor-pointer rounded-full bg-[#1f5ae6] px-6 text-[15px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(31,90,230,0.9)] transition hover:bg-[#1a4fd0] disabled:opacity-60">{pending ? "Sending…" : "Send"}</button>
            <span className="ml-1 text-[12.5px] text-muted max-sm:hidden">⌘ Enter · {data.sendsLeft} sends left today</span>
            <span className="flex-1" />
            <button type="button" aria-label="Discard" onClick={onClose} className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10"><Trash2 className="size-[18px]" /></button>
          </footer>
        </>
      )}
    </section>
  );
}
