"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Bold, Eraser, Italic, Link2, List, ListOrdered, Maximize2, Minus, Quote, Trash2, Type, Underline, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { sendMailAction } from "@/app/mail/(app)/actions";
import { RecipientInput } from "./recipients";
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

const split = (s?: string) => (s ?? "").split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function Composer({ init, onClose, inline = false }: { init: ComposeInit; onClose: () => void; inline?: boolean }) {
  const { data, toastUndo } = useMail();
  const router = useRouter();
  const [from, setFrom] = useState(init.from && data.sendFrom.some((s) => s.id === init.from) ? init.from : data.sendFrom[0]?.id ?? "");
  const [to, setTo] = useState<string[]>(split(init.to));
  const [cc, setCc] = useState<string[]>(split(init.cc));
  const [bcc, setBcc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(!!init.cc);
  const [subject, setSubject] = useState(init.subject ?? "");
  const [showQuote, setShowQuote] = useState(false);
  const [toolbar, setToolbar] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [min, setMin] = useState(false);
  const [big, setBig] = useState(false);
  const [pending, start] = useTransition();
  const editor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editor.current && init.text) editor.current.innerHTML = init.text.split(/\n{2,}/).map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`).join("");
    if (init.mode === "reply" || init.mode === "all") editor.current?.focus();
  }, [init.text, init.mode]);

  const cmd = (name: string, value?: string) => {
    editor.current?.focus();
    document.execCommand(name, false, value);
  };
  const link = () => {
    const url = window.prompt("Link address (https://…)");
    if (url && /^(https?:\/\/|mailto:)/i.test(url.trim())) cmd("createLink", url.trim());
  };

  const send = () =>
    start(async () => {
      setError(null);
      const html = editor.current?.innerHTML ?? "";
      const text = editor.current?.innerText ?? "";
      const r = await sendMailAction({ from, to: to.join(", "), cc: cc.join(", "), bcc: bcc.join(", "), subject, text, html, parentId: init.parentId ?? null, mode: init.mode ?? "new" });
      if (!r.ok) return setError(r.error);
      onClose();
      toastUndo(r.messageId, r.undoSeconds);
      router.refresh();
    });

  const field = "flex min-h-[46px] items-center gap-3 border-b border-black/[0.08] px-5 text-[14.5px] dark:border-white/10";
  const title = init.mode === "reply" ? "Reply" : init.mode === "all" ? "Reply all" : init.mode === "forward" ? "Forward" : "New message";
  const tb = "inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-[#2c2c30] hover:bg-black/[0.07] dark:text-white/85 dark:hover:bg-white/10";

  return (
    <section
      aria-label={title}
      onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } }}
      className={cn(
        "bmail-pop flex flex-col overflow-hidden border border-white/90 bg-white/95 text-text shadow-[0_40px_90px_-40px_rgba(15,23,42,0.55),0_2px_6px_rgba(15,23,42,0.06)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#1c1c22]/95",
        inline ? "rounded-[18px]" : big ? "fixed inset-4 z-50 rounded-[22px] md:inset-x-[10%] md:inset-y-8" : "fixed bottom-0 right-4 z-50 w-[min(680px,calc(100vw-2rem))] rounded-t-[22px] max-md:inset-x-0 max-md:right-0 max-md:w-full",
      )}
    >
      <header className="flex items-center gap-1 bg-[rgba(242,244,250,0.9)] py-2.5 pl-5 pr-2.5 dark:bg-white/5">
        <h2 className="flex-1 text-[15px] font-semibold">{title}</h2>
        {!inline && <button type="button" aria-label="Minimise" onClick={() => setMin((v) => !v)} className={tb}><Minus className="size-4" /></button>}
        {!inline && <button type="button" aria-label="Full screen" onClick={() => setBig((v) => !v)} className={tb}><Maximize2 className="size-4" /></button>}
        <button type="button" aria-label="Close" onClick={onClose} className={tb}><X className="size-4" /></button>
      </header>
      {!min && (
        <>
          <label className={field}><span className="w-14 text-muted">From</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)} className="min-w-0 flex-1 cursor-pointer bg-transparent font-medium outline-none">
              {data.sendFrom.map((s) => <option key={s.id} value={s.id}>{s.label} &lt;{s.address}&gt;</option>)}
            </select>
          </label>
          <div className={field}>
            <label htmlFor="c-to" className="w-14 text-muted">To</label>
            <RecipientInput id="c-to" value={to} onChange={setTo} autoFocus={!init.mode || init.mode === "new" || init.mode === "forward"} placeholder="Type an address and press Enter" />
            {!showCc && <button type="button" onClick={() => setShowCc(true)} className="cursor-pointer text-[13.5px] text-[#1f5ae6]">Cc Bcc</button>}
          </div>
          {showCc && (
            <>
              <div className={field}><label htmlFor="c-cc" className="w-14 text-muted">Cc</label><RecipientInput id="c-cc" value={cc} onChange={setCc} /></div>
              <div className={field}><label htmlFor="c-bcc" className="w-14 text-muted">Bcc</label><RecipientInput id="c-bcc" value={bcc} onChange={setBcc} /></div>
            </>
          )}
          <div className={field}><label htmlFor="c-sub" className="w-14 text-muted">Subject</label><input id="c-sub" value={subject} onChange={(e) => setSubject(e.target.value)} className="min-w-0 flex-1 bg-transparent font-medium outline-none" /></div>
          {toolbar && (
            <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-black/[0.08] px-3 py-1.5 dark:border-white/10">
              <button type="button" aria-label="Bold" title="Bold (⌘B)" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("bold")} className={tb}><Bold className="size-[17px]" /></button>
              <button type="button" aria-label="Italic" title="Italic (⌘I)" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("italic")} className={tb}><Italic className="size-[17px]" /></button>
              <button type="button" aria-label="Underline" title="Underline (⌘U)" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("underline")} className={tb}><Underline className="size-[17px]" /></button>
              <span aria-hidden className="mx-1.5 h-5 w-px bg-black/15 dark:bg-white/15" />
              <button type="button" aria-label="Bulleted list" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("insertUnorderedList")} className={tb}><List className="size-[17px]" /></button>
              <button type="button" aria-label="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("insertOrderedList")} className={tb}><ListOrdered className="size-[17px]" /></button>
              <button type="button" aria-label="Quote" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("formatBlock", "blockquote")} className={tb}><Quote className="size-[17px]" /></button>
              <button type="button" aria-label="Insert link" onMouseDown={(e) => e.preventDefault()} onClick={link} className={tb}><Link2 className="size-[17px]" /></button>
              <span aria-hidden className="mx-1.5 h-5 w-px bg-black/15 dark:bg-white/15" />
              <button type="button" aria-label="Clear formatting" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("removeFormat")} className={tb}><Eraser className="size-[17px]" /></button>
            </div>
          )}
          <div className={cn("flex flex-col overflow-y-auto", big ? "flex-1" : "max-h-[52vh]")}>
            <div
              ref={editor}
              id="c-body"
              role="textbox"
              aria-multiline="true"
              aria-label="Message"
              contentEditable
              suppressContentEditableWarning
              data-placeholder="Write your message"
              className={cn("bmail-editor w-full px-5 pt-4 text-[15px] leading-relaxed outline-none [&_a]:text-[#1f5ae6] [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-[#d1d5db] [&_blockquote]:pl-3 [&_blockquote]:text-[#3c3c43] [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6", big ? "min-h-[40vh]" : "min-h-[180px]")}
            />
            <div aria-label="Your signature" className="mx-5 mb-2 mt-1 border-t border-dashed border-black/15 pt-3 text-[13px] dark:border-white/15" dangerouslySetInnerHTML={{ __html: data.signatureHtml }} />
            {init.quote && (
              <div className="px-5 pb-3">
                <button type="button" onClick={() => setShowQuote((v) => !v)} aria-expanded={showQuote} aria-label={showQuote ? "Hide the earlier message" : "Show the earlier message"} className="inline-flex h-[18px] w-[34px] cursor-pointer items-center justify-center rounded-md bg-[#e8eaef] text-[14px] font-extrabold leading-none tracking-[1px] text-[#3c3c43] hover:bg-[#dcdfe6]">···</button>
                {showQuote && <pre className="bmail-rise mt-3 whitespace-pre-wrap border-l-2 border-[#d1d5db] pl-3 font-sans text-[14px] leading-relaxed text-[#3c3c43] dark:text-white/70">{init.quote}</pre>}
              </div>
            )}
          </div>
          {error && <p role="alert" className="mx-5 mb-2 rounded-xl bg-[#fdecec] px-4 py-2.5 text-[13.5px] font-medium text-[#b42318]">{error}</p>}
          <footer className="flex items-center gap-1.5 border-t border-black/[0.08] bg-[#fbfbfd] px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
            <button type="button" disabled={pending} onClick={send} className="h-11 cursor-pointer rounded-full bg-[#1f5ae6] px-6 text-[15px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(31,90,230,0.9)] transition hover:bg-[#1a4fd0] disabled:opacity-60">{pending ? "Sending…" : "Send"}</button>
            <button type="button" aria-label="Formatting" aria-pressed={toolbar} onClick={() => setToolbar((v) => !v)} className={cn(tb, toolbar && "bg-black/[0.07] dark:bg-white/10")}><Type className="size-[18px]" /></button>
            <span className="ml-1 text-[12.5px] text-muted max-sm:hidden">⌘ Enter · {data.sendsLeft} sends left today</span>
            <span className="flex-1" />
            <button type="button" aria-label="Discard" onClick={onClose} className={tb}><Trash2 className="size-[18px]" /></button>
          </footer>
        </>
      )}
    </section>
  );
}
