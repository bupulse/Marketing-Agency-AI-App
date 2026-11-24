"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useImperativeHandle, useMemo, useRef, useState, useTransition, type Ref } from "react";
import { Bold, ChevronDown, Eraser, Forward, Italic, Link2, List, ListOrdered, Loader2, Maximize2, Minus, Paperclip, Quote, Reply, ReplyAll, Trash2, Type, Underline, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import {
  addressBookAction, discardDraftAction, finishAttachmentAction, removeAttachmentAction, saveDraftAction, sendMailAction, startAttachmentAction, type SendInput,
} from "@/app/mail/(app)/actions";
import type { ReplyMode } from "@/lib/mail/compose-rules";
import { attachmentProblem, fileSize, isDraftEmpty, MAIL_BUCKET_NAME, type ComposeAttachment, type ComposeInit, type ComposeMode } from "@/lib/mail/draft-rules";
import { FIRST_NAME, personalRecipients, splitTokens } from "@/lib/mail/personal";
import type { AddressBook } from "@/lib/mail/suggest";
import { RecipientInput } from "./recipients";
import { useMail } from "./shell";

export type { ComposeInit } from "@/lib/mail/draft-rules";
/** Lets the conversation's Reply / Reply all / Forward buttons switch an open reply box. */
export type ComposerHandle = { switchMode: (m: ReplyMode) => void };

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const AVATAR = ["#8a4b00", "#5131c4", "#11633a", "#3c3c43", "#0d5f61", "#1f5ae6", "#b4236b"];
const tint = (s: string) => AVATAR[[...s].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR.length];
const EXT_COLOR: Record<string, string> = { PDF: "#e5483a", DOC: "#2f6bff", DOCX: "#2f6bff", XLS: "#1f9d55", XLSX: "#1f9d55", CSV: "#64748b", PPT: "#e0662a", PPTX: "#e0662a", JPG: "#a855f7", JPEG: "#a855f7", PNG: "#a855f7", ZIP: "#8e8e93" };
const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()! : "file").slice(0, 4).toUpperCase();
const MODE_LABEL: Record<ReplyMode, string> = { reply: "Reply", all: "Reply all", forward: "Forward" };
const MODE_ICON = { reply: Reply, all: ReplyAll, forward: Forward } as const;

// The address book (people, departments, recent contacts) is loaded once per visit and shared by every composer.
let bookCache: Promise<AddressBook> | null = null;
function useAddressBook(): AddressBook | null {
  const [book, setBook] = useState<AddressBook | null>(null);
  useEffect(() => {
    let live = true;
    bookCache ??= addressBookAction().catch(() => {
      bookCache = null;
      return { people: [], departments: [] };
    });
    bookCache.then((b) => live && setBook(b));
    return () => {
      live = false;
    };
  }, []);
  return book;
}

export function Composer({ init, onClose, inline = false, onModeChange, ref }: { init: ComposeInit; onClose: () => void; inline?: boolean; onModeChange?: (m: ComposeMode) => void; ref?: Ref<ComposerHandle> }) {
  const { data, toastUndo } = useMail();
  const router = useRouter();
  const book = useAddressBook();
  const [from, setFrom] = useState(init.from && data.sendFrom.some((s) => s.id === init.from) ? init.from : data.sendFrom[0]?.id ?? "");
  const [to, setTo] = useState<string[]>(init.to ?? []);
  const [cc, setCc] = useState<string[]>(init.cc ?? []);
  const [bcc, setBcc] = useState<string[]>(init.bcc ?? []);
  const [showCc, setShowCc] = useState(!!(init.cc?.length || init.bcc?.length));
  const [subject, setSubject] = useState(init.subject ?? "");
  const [mode, setMode] = useState<ComposeMode>(init.mode ?? "new");
  const [quote, setQuote] = useState(init.quote);
  const [showQuote, setShowQuote] = useState(false);
  const [modeMenu, setModeMenu] = useState(false);
  const [toolbar, setToolbar] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [min, setMin] = useState(false);
  const [big, setBig] = useState(false);
  const [files, setFiles] = useState<ComposeAttachment[]>(init.attachments ?? []);
  const [uploads, setUploads] = useState<{ key: string; name: string; size: number }[]>([]);
  const [drag, setDrag] = useState(false);
  const [showWho, setShowWho] = useState(false);
  const [touched, setTouched] = useState(false);
  const [bodyVersion, setBodyVersion] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(init.draftId ? "saved" : "idle");
  const [pending, start] = useTransition();
  const editor = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const draftId = useRef<string | null>(init.draftId ?? null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  /** Sent or discarded: no more saving. */
  const done = useRef(false);

  useEffect(() => {
    if (editor.current && (init.html || init.text)) editor.current.innerHTML = init.html ? init.html : init.text!.split(/\n{2,}/).map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`).join("");
    if (init.mode === "reply" || init.mode === "all") editor.current?.focus();
  }, [init.html, init.text, init.mode]);

  const fromAddress = data.sendFrom.find((s) => s.id === from)?.address ?? "";
  const { addresses: typed, departments } = useMemo(() => splitTokens(to), [to]);
  const personal = useMemo(
    () => (departments.length && book ? personalRecipients(departments, typed.map((a) => ({ name: "", address: a.toLowerCase() })), book.departments, [fromAddress, data.me.email]) : null),
    [departments, typed, book, fromAddress, data.me.email],
  );
  const groupSend = departments.length > 0;
  const allowDepartments = mode === "new" || mode === "forward";
  const options = init.options;

  // A click on the signature or the empty space below puts the cursor at the end of the words.
  const focusEnd = () => {
    const el = editor.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };
  const payload = (): SendInput => ({ draftId: draftId.current, from, to, cc, bcc, subject, html: editor.current?.innerHTML ?? "", text: editor.current?.innerText ?? "", parentId: init.parentId ?? null, mode });

  /** Saves the draft (the first save creates it). Saves run one after another, so the id is known to the next one. */
  const save = (): Promise<void> => {
    const input = payload();
    chain.current = chain.current.then(async () => {
      if (done.current) return;
      setSaveState("saving");
      const r = await saveDraftAction({ ...input, draftId: draftId.current }).catch(() => null);
      if (!r) return setSaveState("error");
      if (!r.ok) {
        if (r.gone) done.current = true;
        return setSaveState(r.gone ? "idle" : "error");
      }
      draftId.current = r.draftId;
      if (r.attachments) setFiles(r.attachments);
      setSaveState("saved");
    });
    return chain.current;
  };

  // Draft autosave: a moment after the last change.
  const autosave = useEffectEvent(() => void save());
  useEffect(() => {
    if (!touched) return;
    const t = setTimeout(autosave, 1200);
    return () => clearTimeout(t);
  }, [touched, from, to, cc, bcc, subject, mode, bodyVersion]);
  // Forwarding a message with files: the draft is made at once so the files show as cards.
  const firstSave = useEffectEvent(() => {
    if (init.mode === "forward" && init.parentFiles && !init.draftId) void save();
  });
  useEffect(() => firstSave(), []);

  const touch = () => setTouched(true);
  const cmd = (name: string, value?: string) => {
    editor.current?.focus();
    document.execCommand(name, false, value);
    setBodyVersion((v) => v + 1);
    touch();
  };
  const link = () => {
    const url = window.prompt("Link address (https://…)");
    if (url && /^(https?:\/\/|mailto:)/i.test(url.trim())) cmd("createLink", url.trim());
  };

  const switchMode = (m: ReplyMode) => {
    const o = options?.[m];
    setModeMenu(false);
    if (!o || m === mode) return;
    setMode(m);
    setTo(o.to);
    setCc(o.cc);
    if (o.cc.length) setShowCc(true);
    setSubject(o.subject);
    setQuote(o.quote);
    setShowQuote(m === "forward");
    if (m !== "forward") setFiles((f) => f.filter((x) => !x.forwarded));
    touch();
    onModeChange?.(m);
  };
  useImperativeHandle(ref, () => ({ switchMode }));

  const attach = (list: File[]) => {
    if (!list.length) return;
    setError(null);
    touch();
    let sizes = [...files.map((f) => f.size), ...uploads.map((u) => u.size)];
    for (const file of list) {
      const problem = attachmentProblem(sizes, file.size);
      if (problem) {
        setError(`${file.name}: ${problem}`);
        continue;
      }
      sizes = [...sizes, file.size];
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      setUploads((u) => [...u, { key, name: file.name, size: file.size }]);
      void (async () => {
        try {
          if (!draftId.current) await save();
          const id = draftId.current;
          if (!id) throw new Error("The draft could not be saved, so the file could not be attached. Try again.");
          const slot = await startAttachmentAction(id, { filename: file.name, size: file.size });
          if (!slot.ok) throw new Error(slot.error);
          const { error: failed } = await createClient().storage.from(MAIL_BUCKET_NAME).uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type || "application/octet-stream" });
          if (failed) throw new Error("The upload did not finish. Check the connection and try again.");
          const r = await finishAttachmentAction(id, { path: slot.path, filename: file.name, contentType: file.type });
          if (!r.ok) throw new Error(r.error);
          setFiles((f) => [...f, r.attachment]);
        } catch (e) {
          setError(`${file.name}: ${e instanceof Error ? e.message : "it could not be attached."}`);
        } finally {
          setUploads((u) => u.filter((x) => x.key !== key));
        }
      })();
    }
  };
  const removeFile = (f: ComposeAttachment) => {
    setFiles((x) => x.filter((y) => y.id !== f.id));
    void removeAttachmentAction(f.id);
  };

  const send = () =>
    start(async () => {
      setError(null);
      if (uploads.length) return setError("Wait until the files finish uploading.");
      const waiting = chain.current;
      done.current = true;
      await waiting;
      const r = await sendMailAction({ ...payload(), draftId: draftId.current });
      if (!r.ok) {
        done.current = false;
        return setError(r.error);
      }
      onClose();
      toastUndo(r.messageId, r.undoSeconds, r.count);
      router.refresh();
    });

  /** Close: a draft worth keeping is saved; an empty one (nothing typed, no files) is dropped. */
  const close = () => {
    const wasDone = done.current;
    done.current = true;
    onClose();
    if (wasDone) return;
    const empty = isDraftEmpty({ to, cc, bcc, subject, bodyText: editor.current?.innerText ?? "", attachments: files, initial: { to: init.to, cc: init.cc, bcc: init.bcc, subject: init.subject } });
    const fresh = !init.draftId;
    if (!touched && !(fresh && draftId.current)) return;
    const input = payload();
    void chain.current.then(async () => {
      const id = draftId.current;
      if (empty && fresh) {
        if (id) await discardDraftAction(id);
      } else if (touched) {
        await saveDraftAction({ ...input, draftId: id });
      }
      router.refresh();
    });
  };
  const discard = () => {
    done.current = true;
    onClose();
    void chain.current.then(async () => {
      if (!draftId.current) return;
      await discardDraftAction(draftId.current);
      router.refresh();
    });
  };

  const field = "flex min-h-[46px] items-center gap-3 border-b border-black/[0.08] px-5 text-[14.5px] dark:border-white/10";
  const title = mode === "reply" ? "Reply" : mode === "all" ? "Reply all" : mode === "forward" ? "Forward" : init.draftId ? "Draft" : "New message";
  const tb = "inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-[#2c2c30] hover:bg-black/[0.07] dark:text-white/85 dark:hover:bg-white/10";
  const n = personal?.length ?? 0;
  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "saved" ? "Draft saved" : saveState === "error" ? "Not saved yet" : "";
  const ModeIcon = mode !== "new" ? MODE_ICON[mode] : Reply;

  return (
    <section
      aria-label={title}
      onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } }}
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false); }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setDrag(false); attach([...e.dataTransfer.files]); } }}
      className={cn(
        "bmail-pop flex flex-col border border-white/90 [&>*]:shrink-0 bg-white/95 text-text shadow-[0_40px_90px_-40px_rgba(15,23,42,0.55),0_2px_6px_rgba(15,23,42,0.06)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#1c1c22]/95",
        inline ? "relative overflow-hidden rounded-[18px]" : big ? "fixed inset-4 z-50 overflow-y-auto overscroll-contain rounded-[22px] md:inset-x-[10%] md:inset-y-8" : "fixed bottom-0 right-4 z-50 max-h-[calc(100dvh-12px)] w-[min(680px,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-t-[22px] max-md:inset-x-0 max-md:right-0 max-md:w-full",
      )}
    >
      {inline ? (
        <header className="relative flex items-center gap-2 border-b border-black/[0.08] py-1.5 pl-3 pr-2 dark:border-white/10">
          {options ? (
            <button type="button" aria-haspopup="menu" aria-expanded={modeMenu} onClick={() => setModeMenu((v) => !v)} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[13.5px] font-medium text-[#5c5c63] hover:bg-black/[0.06] dark:text-white/70 dark:hover:bg-white/10">
              <ModeIcon className="size-4" />{title}<ChevronDown className="size-3.5" />
            </button>
          ) : (
            <span className="inline-flex h-9 items-center gap-1.5 px-2.5 text-[13.5px] font-medium text-[#5c5c63]"><ModeIcon className="size-4" />{title}</span>
          )}
          {modeMenu && options && (
            <div role="menu" aria-label="Reply, reply all or forward" className="bmail-rise absolute left-2 top-full z-30 mt-1 w-48 rounded-2xl border border-black/[0.12] bg-white/95 p-1.5 shadow-[0_24px_50px_-20px_rgba(15,23,42,0.45)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#26262c]/95">
              {(["reply", "all", "forward"] as const).filter((m) => options[m]).map((m) => {
                const Icon = MODE_ICON[m];
                return (
                  <button key={m} type="button" role="menuitemradio" aria-checked={mode === m} onClick={() => switchMode(m)} className={cn("flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[14px] hover:bg-black/[0.05] dark:hover:bg-white/10", mode === m && "font-semibold text-[#1f5ae6]")}>
                    <Icon className="size-4" />{MODE_LABEL[m]}
                  </button>
                );
              })}
            </div>
          )}
          <span className="flex-1" />
          <button type="button" aria-label="Close" onClick={close} className={tb}><X className="size-4" /></button>
        </header>
      ) : (
        <header className="sticky top-0 z-20 flex items-center gap-1 rounded-t-[inherit] bg-[rgb(242,244,250)] py-2.5 pl-5 pr-2.5 dark:bg-[#26262d]">
          <h2 className="flex-1 text-[15px] font-semibold">{title}</h2>
          <button type="button" aria-label="Minimise" onClick={() => setMin((v) => !v)} className={tb}><Minus className="size-4" /></button>
          <button type="button" aria-label="Full screen" onClick={() => setBig((v) => !v)} className={tb}><Maximize2 className="size-4" /></button>
          <button type="button" aria-label="Close" onClick={close} className={tb}><X className="size-4" /></button>
        </header>
      )}
      {!min && (
        <>
          {!inline && (
            <label className={field}><span className="w-14 text-muted">From</span>
              <select value={from} onChange={(e) => { setFrom(e.target.value); touch(); }} className="min-w-0 flex-1 cursor-pointer bg-transparent font-medium outline-none">
                {data.sendFrom.map((s) => <option key={s.id} value={s.id}>{s.label} &lt;{s.address}&gt;</option>)}
              </select>
            </label>
          )}
          <div className={cn(field, "relative")}>
            <label htmlFor={`c-to-${inline ? "r" : "n"}`} className="w-14 text-muted">To</label>
            <RecipientInput id={`c-to-${inline ? "r" : "n"}`} value={to} onChange={(v) => { setTo(v); touch(); }} book={book} departments={allowDepartments} autoFocus={!init.draftId && (!init.mode || init.mode === "new" || init.mode === "forward")} placeholder={allowDepartments && book?.departments.length ? "Type a name, address or department" : "Type a name or address"} />
            {!showCc && !groupSend && <button type="button" onClick={() => setShowCc(true)} className="cursor-pointer text-[13.5px] text-[#1f5ae6]">Cc Bcc</button>}
          </div>
          {showCc && !groupSend && (
            <>
              <div className={field}><label htmlFor={`c-cc-${inline ? "r" : "n"}`} className="w-14 text-muted">Cc</label><RecipientInput id={`c-cc-${inline ? "r" : "n"}`} value={cc} onChange={(v) => { setCc(v); touch(); }} book={book} /></div>
              <div className={field}><label htmlFor={`c-bcc-${inline ? "r" : "n"}`} className="w-14 text-muted">Bcc</label><RecipientInput id={`c-bcc-${inline ? "r" : "n"}`} value={bcc} onChange={(v) => { setBcc(v); touch(); }} book={book} /></div>
            </>
          )}
          {groupSend && (
            <div className="mx-5 mt-2.5 flex flex-wrap items-center gap-3 rounded-[14px] bg-[rgba(31,90,230,0.07)] px-3.5 py-3 text-[13.5px] dark:bg-[rgba(122,162,255,0.12)]">
              {personal && n > 0 && (
                <span className="inline-flex" aria-hidden>
                  {personal.slice(0, 4).map((p, i) => <span key={p.address} className={cn("inline-flex size-[26px] items-center justify-center rounded-full text-[11px] font-semibold text-white shadow-[0_0_0_2px_#fff] dark:shadow-[0_0_0_2px_#1c1c22]", i > 0 && "-ml-1.5")} style={{ background: tint(p.address) }}>{p.firstName[0]?.toUpperCase()}</span>)}
                </span>
              )}
              <span className="flex-[1_1_300px]">
                {!personal ? "Counting who gets it…" : n === 0 ? "Nobody else is in this department yet." : (
                  <>Sends <strong>{n} personal email{n === 1 ? "" : "s"}</strong>, each starting with the person&apos;s name. {n > data.sendsLeft ? <strong className="text-[#b42318]">Only {data.sendsLeft} sends are left today.</strong> : <>Uses {n} of the {data.sendsLeft} sends left today.</>}</>
                )}
              </span>
              {personal && n > 0 && <button type="button" aria-expanded={showWho} onClick={() => setShowWho((v) => !v)} className="cursor-pointer font-semibold text-[#1f5ae6]">{showWho ? "Hide the list" : "See who gets it"}</button>}
              {showWho && personal && (
                <ul aria-label="Who gets it" className="bmail-rise flex max-h-48 basis-full flex-col gap-0.5 overflow-y-auto rounded-xl bg-white/80 p-1.5 dark:bg-white/5">
                  {personal.map((p) => (
                    <li key={p.address} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                      <span aria-hidden className="inline-flex size-6 items-center justify-center rounded-full text-[10.5px] font-semibold text-white" style={{ background: tint(p.address) }}>{p.firstName[0]?.toUpperCase()}</span>
                      <span className="font-medium">{p.name}</span><span className="truncate text-muted">{p.address}</span>
                      <span className="ml-auto text-[12px] text-muted">&ldquo;Hello {p.firstName},&rdquo;</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {(!inline || mode === "forward") && (
            <div className={cn(field, groupSend && "border-t-0")}><label htmlFor={`c-sub-${inline ? "r" : "n"}`} className="w-14 text-muted">Subject</label><input id={`c-sub-${inline ? "r" : "n"}`} value={subject} onChange={(e) => { setSubject(e.target.value); touch(); }} className="min-w-0 flex-1 bg-transparent font-medium outline-none" /></div>
          )}
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
          <div className={cn("flex flex-col", big ? "flex-1" : "min-h-[200px]")}>
            {groupSend && (
              <p className="px-5 pt-4 text-[15px]">
                <span className="inline-flex h-[26px] items-center rounded-lg bg-[#fdf0d9] px-2.5 text-[13.5px] font-semibold text-[#7d4c00]">Hello {FIRST_NAME},</span>{" "}
                <span className="text-[12.5px] text-muted">added for each person</span>
              </p>
            )}
            <div
              ref={editor}
              id={`c-body-${inline ? "r" : "n"}`}
              role="textbox"
              aria-multiline="true"
              aria-label="Message"
              contentEditable
              suppressContentEditableWarning
              data-placeholder="Write your message"
              onInput={() => { setBodyVersion((v) => v + 1); touch(); }}
              onPaste={(e) => { const list = [...e.clipboardData.files]; if (list.length) { e.preventDefault(); attach(list); } }}
              className={cn("bmail-editor w-full px-5 text-[15px] leading-relaxed outline-none [&_a]:text-[#1f5ae6] [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-[#d1d5db] [&_blockquote]:pl-3 [&_blockquote]:text-[#3c3c43] [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6", groupSend ? "pt-2" : "pt-4", "min-h-[72px]")}
            />
            {(files.length > 0 || uploads.length > 0) && (
              <div aria-label="Attachments" className="flex flex-wrap gap-2 px-5 pb-2 pt-1">
                {files.map((f) => <FileCard key={f.id} name={f.filename} note={`${fileSize(f.size)}${f.forwarded ? " · forwarded" : ""}`} onRemove={() => removeFile(f)} />)}
                {uploads.map((u) => <FileCard key={u.key} name={u.name} note={`${fileSize(u.size)} · uploading…`} busy />)}
              </div>
            )}
            {/* The signature sits right under the words, as one message (owner 24 Nov: "make it united"); it is added when the email goes out. */}
            <div aria-label="Your signature (added when you send)" title="Your signature: change it in Settings" onClick={(e) => { e.preventDefault(); focusEnd(); }} className="cursor-text px-5 pb-2 pt-1 text-[14px] opacity-90" dangerouslySetInnerHTML={{ __html: data.signatureHtml }} />
            {quote && (
              <div className="px-5 pb-3">
                <button type="button" onClick={() => setShowQuote((v) => !v)} aria-expanded={showQuote} aria-label={showQuote ? "Hide the earlier message" : "Show the earlier message"} className="inline-flex h-[18px] w-[34px] cursor-pointer items-center justify-center rounded-md bg-[#e8eaef] text-[14px] font-extrabold leading-none tracking-[1px] text-[#3c3c43] hover:bg-[#dcdfe6]">···</button>
                {showQuote && (
                  <div className="bmail-rise mt-3 text-[14px] leading-relaxed text-[#3c3c43] dark:text-white/70">
                    <div className="mb-2 whitespace-pre-line text-[#5c5c63] dark:text-white/55">{quote.head}</div>
                    <div className="whitespace-pre-wrap border-l-2 border-[#d1d5db] pl-3">{quote.body}</div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div aria-hidden onClick={focusEnd} className={cn("cursor-text", big ? "min-h-6 flex-1" : "min-h-6")} />
          {error && <p role="alert" className="mx-5 mb-2 rounded-xl bg-[#fdecec] px-4 py-2.5 text-[13.5px] font-medium text-[#b42318]">{error}</p>}
          <footer className="sticky bottom-0 z-10 flex flex-wrap items-center gap-1.5 border-t border-black/[0.08] bg-[#fbfbfd] px-4 py-3 dark:border-white/10 dark:bg-[#202027]">
            <button type="button" disabled={pending || uploads.length > 0} onClick={send} className="h-11 cursor-pointer rounded-full bg-[#1f5ae6] px-6 text-[15px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(31,90,230,0.9)] transition hover:bg-[#1a4fd0] disabled:opacity-60">
              {pending ? "Sending…" : groupSend && n > 0 ? `Send ${n} email${n === 1 ? "" : "s"}` : "Send"}
            </button>
            <button type="button" aria-label="Formatting" aria-pressed={toolbar} onClick={() => setToolbar((v) => !v)} className={cn(tb, toolbar && "bg-black/[0.07] dark:bg-white/10")}><Type className="size-[18px]" /></button>
            <button type="button" aria-label="Attach files" title="Attach files (or drop them here)" onClick={() => fileInput.current?.click()} className={tb}><Paperclip className="size-[18px]" /></button>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => { attach([...(e.target.files ?? [])]); e.target.value = ""; }} />
            {groupSend && <button type="button" aria-label="Insert {first_name}" title="Put the person's first name here" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("insertText", FIRST_NAME)} className="inline-flex h-9 cursor-pointer items-center rounded-lg px-3 text-[13px] font-semibold text-[#2c2c30] hover:bg-black/[0.07] dark:text-white/85 dark:hover:bg-white/10">{FIRST_NAME}</button>}
            <span className="ml-1 text-[12.5px] text-muted max-sm:hidden">⌘ Enter{groupSend ? "" : ` · ${data.sendsLeft} sends left today`}</span>
            <span className="flex-1" />
            <span aria-live="polite" className="text-[12.5px] text-muted">{saveLabel}</span>
            <button type="button" aria-label="Discard draft" title="Discard draft" onClick={discard} className={tb}><Trash2 className="size-[18px]" /></button>
          </footer>
        </>
      )}
      {drag && (
        <div aria-hidden className="pointer-events-none absolute inset-2 z-40 flex flex-col items-center justify-center gap-2 rounded-[16px] border-2 border-dashed border-[#1f5ae6] bg-white/85 text-[15px] font-semibold text-[#1f5ae6] backdrop-blur-sm dark:bg-[#1c1c22]/85">
          <Paperclip className="size-6" />Drop files to attach
        </div>
      )}
    </section>
  );
}

function FileCard({ name, note, onRemove, busy }: { name: string; note: string; onRemove?: () => void; busy?: boolean }) {
  const ext = extOf(name);
  return (
    <span className="inline-flex h-12 max-w-[260px] items-center gap-2.5 rounded-xl bg-white pl-2 pr-1.5 shadow-[0_0_0_1px_rgba(60,60,67,0.14)] dark:bg-white/5 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]">
      <span className="rounded-md px-1.5 py-0.5 text-[10px] font-extrabold text-white" style={{ background: EXT_COLOR[ext] ?? "#8e8e93" }}>{ext}</span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight"><span className="truncate text-[13px] font-semibold">{name}</span><span className="truncate text-[11.5px] text-muted">{note}</span></span>
      {busy ? (
        <Loader2 aria-label="Uploading" className="mx-1.5 size-4 animate-spin text-[#1f5ae6]" />
      ) : (
        <button type="button" aria-label={`Remove ${name}`} onClick={onRemove} className="inline-flex size-7 cursor-pointer items-center justify-center rounded-lg hover:bg-black/[0.07] dark:hover:bg-white/10"><X className="size-3.5" /></button>
      )}
    </span>
  );
}
