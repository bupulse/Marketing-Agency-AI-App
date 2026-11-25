"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import {
  AlignCenter, AlignLeft, AlignRight, ALargeSmall, Baseline, Bold, Check, ChevronDown, IndentDecrease, IndentIncrease, Italic,
  Link2, List, ListOrdered, Quote, Redo2, RemoveFormatting, Strikethrough, Underline, Undo2,
} from "lucide-react";
import { cn } from "@/lib/cn";

// Gmail's formatting bar (owner 25 Nov 2026: "bold, italic, underlined, numbered, listed, pointed, the font style…
// just like in Gmail"). Every control keeps the text selection (mousedown is cancelled), so the change lands on the
// selected words. What it writes (font, size, colour, alignment, indents) survives lib/mail/sanitize.ts.

export const FONTS: { label: string; face: string }[] = [
  { label: "Sans Serif", face: "arial, sans-serif" },
  { label: "Serif", face: "times new roman, serif" },
  { label: "Fixed width", face: "monospace" },
  { label: "Wide", face: "arial black, sans-serif" },
  { label: "Narrow", face: "arial narrow, sans-serif" },
  { label: "Comic Sans MS", face: "comic sans ms, sans-serif" },
  { label: "Garamond", face: "garamond, serif" },
  { label: "Georgia", face: "georgia, serif" },
  { label: "Tahoma", face: "tahoma, sans-serif" },
  { label: "Trebuchet MS", face: "trebuchet ms, sans-serif" },
  { label: "Verdana", face: "verdana, sans-serif" },
];
const SIZES: { label: string; size: string; px: number }[] = [
  { label: "Small", size: "1", px: 11 },
  { label: "Normal", size: "2", px: 14 },
  { label: "Large", size: "4", px: 18 },
  { label: "Huge", size: "6", px: 26 },
];
const PALETTE = [
  "#000000", "#444444", "#666666", "#999999", "#cccccc", "#eeeeee", "#f3f3f3", "#ffffff",
  "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#9900ff", "#ff00ff",
  "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#cfe2f3", "#d9d2e9", "#ead1dc",
  "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#9fc5e8", "#b4a7d6", "#d5a6bd",
  "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6fa8dc", "#8e7cc3", "#c27ba0",
  "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3d85c6", "#674ea7", "#a64d79",
  "#990000", "#b45f06", "#bf9000", "#38761d", "#134f5c", "#0b5394", "#351c75", "#741b47",
  "#660000", "#783f04", "#7f6000", "#274e13", "#0c343d", "#073763", "#20124d", "#4c1130",
];

type Cmd = (name: string, value?: string) => void;
const STATES = ["bold", "italic", "underline", "strikeThrough", "insertOrderedList", "insertUnorderedList", "justifyCenter", "justifyRight"] as const;
type State = Partial<Record<(typeof STATES)[number], boolean>> & { font?: string };

const keep = (e: { preventDefault: () => void }) => e.preventDefault();
const btn = "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded text-[#444746] hover:bg-black/[0.07] dark:text-white/80 dark:hover:bg-white/10";
const on = "bg-[#d3e3fd] text-[#041e49] hover:bg-[#c2d7fb] dark:bg-[#3b4a66] dark:text-white";
const sep = <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-black/15 dark:bg-white/15" />;

/** Gmail's keyboard shortcuts that the browser does not already handle (⌘B/I/U/Z are built in). */
export function formatShortcut(e: KeyboardEvent, cmd: Cmd): boolean {
  if (!(e.metaKey || e.ctrlKey)) return false;
  const k = e.key;
  const map: Record<string, [string, string?]> = e.shiftKey
    ? { "7": ["insertOrderedList"], "&": ["insertOrderedList"], "8": ["insertUnorderedList"], "*": ["insertUnorderedList"], "9": ["formatBlock", "blockquote"], "(": ["formatBlock", "blockquote"], x: ["strikeThrough"], X: ["strikeThrough"], l: ["justifyLeft"], L: ["justifyLeft"], e: ["justifyCenter"], E: ["justifyCenter"], r: ["justifyRight"], R: ["justifyRight"] }
    : { "]": ["indent"], "[": ["outdent"], "\\": ["removeFormat"] };
  const hit = map[k];
  if (!hit) return false;
  e.preventDefault();
  cmd(hit[0], hit[1]);
  return true;
}

function Pop({ label, title, trigger, wide, children }: { label: string; title: string; trigger: ReactNode; wide?: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // Keep the menu inside the compose window (it would be cut off at the window's edge otherwise).
  useLayoutEffect(() => {
    const m = menu.current;
    const frame = m?.closest("section");
    if (!open || !m || !frame) return;
    m.style.marginLeft = "0px";
    m.style.maxHeight = "";
    const fr = frame.getBoundingClientRect();
    // Room above the toolbar, below the window's title bar (and the screen top): the menu scrolls if it needs more.
    const room = m.getBoundingClientRect().bottom - Math.max(fr.top + 48, 8);
    if (m.scrollHeight > room) m.style.maxHeight = `${Math.max(120, Math.floor(room))}px`;
    const mr = m.getBoundingClientRect();
    let dx = 0;
    if (mr.right > fr.right - 8) dx = fr.right - 8 - mr.right;
    if (mr.left + dx < fr.left + 8) dx = fr.left + 8 - mr.left;
    m.style.marginLeft = `${Math.round(dx)}px`;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" aria-label={label} title={title} aria-haspopup="menu" aria-expanded={open} onMouseDown={keep} onClick={() => setOpen((v) => !v)} className={cn(btn, wide && "w-auto gap-1 px-2", open && on)}>{trigger}</button>
      {open && (
        <div ref={menu} role="menu" aria-label={label} className="bmail-rise absolute bottom-full left-0 z-40 mb-1.5 w-max max-h-[60vh] overflow-y-auto rounded-lg bg-white py-1.5 text-[14px] text-[#1f1f1f] shadow-[0_2px_6px_2px_rgba(0,0,0,0.15),0_1px_2px_rgba(0,0,0,0.3)] dark:bg-[#2a2a31] dark:text-white">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function FormatBar({ cmd, link, editor }: { cmd: Cmd; link: () => void; editor: RefObject<HTMLDivElement | null> }) {
  const [state, setState] = useState<State>({});
  useEffect(() => {
    const read = () => {
      const sel = document.getSelection();
      if (!sel?.anchorNode || !editor.current?.contains(sel.anchorNode)) return;
      const next: State = {};
      for (const s of STATES) {
        try { next[s] = document.queryCommandState(s); } catch { /* not supported: leave off */ }
      }
      try { next.font = String(document.queryCommandValue("fontName") || "").replace(/["']/g, "").toLowerCase(); } catch { /* ignore */ }
      setState(next);
    };
    document.addEventListener("selectionchange", read);
    return () => document.removeEventListener("selectionchange", read);
  }, [editor]);

  const font = FONTS.find((f) => state.font && f.face.split(",")[0] === state.font.split(",")[0].trim()) ?? FONTS[0];
  const b = (label: string, title: string, icon: ReactNode, run: () => void, active?: boolean) => (
    <button type="button" aria-label={label} title={title} aria-pressed={active ?? undefined} onMouseDown={keep} onClick={run} className={cn(btn, active && on)}>{icon}</button>
  );
  const Align = state.justifyCenter ? AlignCenter : state.justifyRight ? AlignRight : AlignLeft;

  return (
    <div role="toolbar" aria-label="Formatting" className="mx-3 mt-1 flex flex-wrap items-center gap-px rounded-lg bg-white px-1 py-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.3),0_1px_3px_1px_rgba(0,0,0,0.15)] dark:bg-[#2a2a31]">
      {b("Undo", "Undo (⌘Z)", <Undo2 className="size-4" />, () => cmd("undo"))}
      {b("Redo", "Redo (⌘Y)", <Redo2 className="size-4" />, () => cmd("redo"))}
      {sep}
      <Pop label="Font" title="Font" wide trigger={<><span className="max-w-[78px] truncate text-[13px]" style={{ fontFamily: font.face }}>{font.label}</span><ChevronDown className="size-3.5" /></>}>
        {(close) => FONTS.map((f) => (
          <button key={f.label} type="button" role="menuitemradio" aria-checked={f === font} onMouseDown={keep} onClick={() => { cmd("fontName", f.face); close(); }} className="flex w-48 cursor-pointer items-center gap-2 px-3 py-1.5 text-left hover:bg-black/[0.06] dark:hover:bg-white/10" style={{ fontFamily: f.face }}>
            <Check className={cn("size-4 shrink-0", f !== font && "invisible")} />{f.label}
          </button>
        ))}
      </Pop>
      {sep}
      <Pop label="Size" title="Size" trigger={<ALargeSmall className="size-[18px]" />}>
        {(close) => SIZES.map((s) => (
          <button key={s.label} type="button" role="menuitem" onMouseDown={keep} onClick={() => { cmd("fontSize", s.size); close(); }} className="flex w-36 cursor-pointer items-center px-4 py-1.5 text-left hover:bg-black/[0.06] dark:hover:bg-white/10" style={{ fontSize: s.px }}>
            {s.label}
          </button>
        ))}
      </Pop>
      {sep}
      {b("Bold", "Bold (⌘B)", <Bold className="size-4" />, () => cmd("bold"), !!state.bold)}
      {b("Italic", "Italic (⌘I)", <Italic className="size-4" />, () => cmd("italic"), !!state.italic)}
      {b("Underline", "Underline (⌘U)", <Underline className="size-4" />, () => cmd("underline"), !!state.underline)}
      <Pop label="Text colour" title="Text colour" trigger={<Baseline className="size-[18px]" />}>
        {(close) => (
          <div className="flex gap-4 px-3 py-1.5 max-sm:flex-col">
            {([["Background colour", "hiliteColor"], ["Text colour", "foreColor"]] as const).map(([title, command]) => (
              <div key={command}>
                <p className="mb-1.5 whitespace-nowrap text-[12.5px] font-medium text-[#444746] dark:text-white/70">{title}</p>
                <div className="grid grid-cols-[repeat(8,16px)] gap-0.5">
                  {PALETTE.map((c) => (
                    <button key={c} type="button" aria-label={`${title} ${c}`} title={c} onMouseDown={keep} onClick={() => { cmd(command, c); close(); }} className="size-4 cursor-pointer rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)] hover:scale-110" style={{ background: c }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Pop>
      {sep}
      <Pop label="Align" title="Align" trigger={<Align className="size-4" />}>
        {(close) => (
          <div className="flex gap-0.5 px-1.5">
            {b("Align left", "Align left (⌘⇧L)", <AlignLeft className="size-4" />, () => { cmd("justifyLeft"); close(); }, !state.justifyCenter && !state.justifyRight)}
            {b("Align centre", "Align centre (⌘⇧E)", <AlignCenter className="size-4" />, () => { cmd("justifyCenter"); close(); }, !!state.justifyCenter)}
            {b("Align right", "Align right (⌘⇧R)", <AlignRight className="size-4" />, () => { cmd("justifyRight"); close(); }, !!state.justifyRight)}
          </div>
        )}
      </Pop>
      {b("Numbered list", "Numbered list (⌘⇧7)", <ListOrdered className="size-4" />, () => cmd("insertOrderedList"), !!state.insertOrderedList)}
      {b("Bulleted list", "Bulleted list (⌘⇧8)", <List className="size-4" />, () => cmd("insertUnorderedList"), !!state.insertUnorderedList)}
      {b("Indent less", "Indent less (⌘[)", <IndentDecrease className="size-4" />, () => cmd("outdent"))}
      {b("Indent more", "Indent more (⌘])", <IndentIncrease className="size-4" />, () => cmd("indent"))}
      <Pop label="More formatting options" title="More formatting options" trigger={<ChevronDown className="size-4" />}>
        {(close) => (
          <div className="flex gap-0.5 px-1.5">
            {b("Quote", "Quote (⌘⇧9)", <Quote className="size-4" />, () => { cmd("formatBlock", "blockquote"); close(); })}
            {b("Strikethrough", "Strikethrough (⌘⇧X)", <Strikethrough className="size-4" />, () => { cmd("strikeThrough"); close(); }, !!state.strikeThrough)}
            {b("Insert link", "Insert link", <Link2 className="size-4" />, () => { close(); link(); })}
            {b("Remove formatting", "Remove formatting (⌘\\)", <RemoveFormatting className="size-4" />, () => { cmd("removeFormat"); close(); })}
          </div>
        )}
      </Pop>
    </div>
  );
}
