"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { Archive, CornerUpRight, File, Inbox, LayoutGrid, Menu, Moon, OctagonAlert, Pencil, Search, Send, Shuffle, SlidersHorizontal, Star, Sun, Tag, Trash2, X } from "lucide-react";
import { useTheme } from "@/components/theme";
import { cn } from "@/lib/cn";
import { glassStyle, MAIL_BACKGROUNDS, RANDOM_BACKGROUND } from "@/lib/mail/backgrounds";
import { BLockup } from "./brand";
import { NewMailNotices } from "./notices";
import { AccountMenu } from "./account-menu";
import { Composer, type ComposeInit } from "./composer";
import { setMailLook, undoSendAction } from "@/app/mail/(app)/actions";

export type NavMailbox = { id: string; name: string; address: string | null; kind: string; visibility: string; unread: number; color: string | null };
export type ShellData = {
  me: { name: string; email: string; isAdmin: boolean; initial: string; role: string; photo: string | null };
  mailboxes: NavMailbox[];
  sendFrom: { id: string; label: string; address: string }[];
  signatureHtml: string;
  sendsLeft: number;
  /** The person's choice (a background id, "random" or "photo"). */
  background: string;
  /** What is painted today (Random resolved, own photo as a signed link). */
  backgroundCss: string;
  backgroundName: string;
  /** A dark picture (night scenes, own photo): the menu and top bar switch to white text. */
  backgroundDark: boolean;
  hasPhoto: boolean;
  glass: number;
  /** The company's glass tint (Mail console): light, dark (dark panels for everyone) or blue. */
  glassTint: string;
  canChangeGlass: boolean;
  forwarded: { address: string; unread: number; total: number }[];
  drafts: number;
  storage: { usedMb: number; quotaMb: number };
};

type Ctx = { compose: (init?: ComposeInit) => void; toastUndo: (messageId: string, seconds: number) => void; data: ShellData; openMenu: () => void };
const ShellCtx = createContext<Ctx | null>(null);
export const useMail = () => {
  const c = useContext(ShellCtx);
  if (!c) throw new Error("useMail outside MailShell");
  return c;
};

const FOLDERS = [
  { id: "starred", label: "Starred", icon: Star },
  { id: "sent", label: "Sent", icon: Send },
  { id: "drafts", label: "Drafts", icon: File },
  { id: "archive", label: "Archive", icon: Archive },
  { id: "spam", label: "Spam", icon: OctagonAlert },
  { id: "trash", label: "Trash", icon: Trash2 },
] as const;

const TAGS = [
  ["bank", "Bank", "#1f9d55"], ["invoices", "Invoices", "#d98a00"], ["payments", "Payments", "#d98a00"], ["receipts", "Receipts", "#b8860b"],
  ["leads", "Leads", "#2f6bff"], ["support", "Support", "#14a3a6"], ["partners", "Partners", "#7b5cff"], ["updates", "Updates", "#8e8e93"],
] as const;

const PHONE = "(max-width: 767px)";

export function MailShell({ data, children }: { data: ShellData; children: ReactNode }) {
  // Two menu states, chosen by CSS so nothing flashes: open on computers, a closed sheet on phones.
  const [deskMenu, setDeskMenu] = useState(true);
  const [phoneMenu, setPhoneMenu] = useState(false);
  // The menu as a sheet over everything (full screen reading: "an icon to bring the left menu").
  const [sheet, setSheet] = useState(false);
  const toggleMenu = () => (window.matchMedia(PHONE).matches ? setPhoneMenu((v) => !v) : setDeskMenu((v) => !v));
  const [panel, setPanel] = useState(false);
  const [compose, setCompose] = useState<ComposeInit | null>(null);
  const [undo, setUndo] = useState<{ id: string; left: number } | null>(null);
  const [glass, setGlass] = useState(data.glass);
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const box = sp.get("box") ?? "all";
  const folder = sp.get("folder") ?? "inbox";
  const tag = sp.get("tag");
  const fwd = sp.get("fwd");
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const searchRef = useRef<HTMLInputElement>(null);

  // The phone sheet closes after every move, so it never covers the mail.
  const navKey = `${path}?${sp.toString()}`;
  const [seenKey, setSeenKey] = useState(navKey);
  if (seenKey !== navKey) {
    setSeenKey(navKey);
    setPhoneMenu(false);
    setSheet(false);
  }
  // A saved Glass value from the server replaces the local one (React's "adjust state on a prop change").
  const [seenGlass, setSeenGlass] = useState(data.glass);
  if (seenGlass !== data.glass) {
    setSeenGlass(data.glass);
    setGlass(data.glass);
  }

  const toastUndo = useCallback((id: string, seconds: number) => setUndo({ id, left: seconds }), []);
  useEffect(() => {
    if (!undo) return;
    if (undo.left <= 0) {
      const t = setTimeout(() => {
        setUndo(null);
        router.refresh();
      }, 1200);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setUndo((u) => (u ? { ...u, left: u.left - 1 } : u)), 1000);
    return () => clearTimeout(t);
  }, [undo, router]);

  // Keyboard: c compose, / search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable=true], select")) return;
      if (e.key === "c" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setCompose({}); }
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ctx = useMemo<Ctx>(() => ({ compose: (init) => setCompose(init ?? {}), toastUndo, data, openMenu: () => setSheet(true) }), [toastUndo, data]);
  const href = (q: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
    const s = p.toString();
    return `/mail${s ? `?${s}` : ""}`;
  };
  const onList = path === "/mail";
  const allUnread = data.mailboxes.reduce((n, m) => n + m.unread, 0);
  const shared = data.mailboxes.filter((m) => m.kind !== "personal" && m.kind !== "catchall");
  const personal = data.mailboxes.filter((m) => m.kind === "personal");
  const other = data.mailboxes.filter((m) => m.kind === "catchall");
  const g = glassStyle(glass, dark);
  const plain = data.backgroundCss.startsWith("var(");
  const style = {
    // Dark mode darkens the picture a little (design "MainDark"), so the glass and the text stay readable.
    background: dark && !plain ? `linear-gradient(rgba(8,8,12,.5), rgba(8,8,12,.5)), ${data.backgroundCss}` : data.backgroundCss,
    backgroundAttachment: "fixed",
    "--bmail-a": String(g.alpha),
    "--bmail-strong": String(g.strong),
    "--bmail-blur": `${g.blur}px`,
    ...(data.glassTint === "blue" && !dark ? { "--bmail-rgb": "232, 238, 255" } : {}),
  } as CSSProperties;

  const navBody = (
    <>
              <button type="button" onClick={() => setCompose({})} className="mb-3 ml-1 mt-1 inline-flex h-14 w-fit cursor-pointer items-center gap-3.5 rounded-[18px] border border-white/80 bg-white/85 pl-[18px] pr-6 text-[15px] font-semibold shadow-[0_8px_24px_-12px_rgba(0,0,0,0.35)] backdrop-blur-xl transition hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.45)] dark:border-white/10 dark:bg-[rgba(48,48,56,0.9)]"><Pencil className="size-5" />Compose</button>
              <NavLink href={href({ folder: "inbox" })} active={onList && box === "all" && folder === "inbox" && !tag && !fwd} icon={<Inbox className="size-[18px]" />} label="All inboxes" count={allUnread} />
              {personal.map((m) => <NavLink key={m.id} href={href({ box: m.id })} active={onList && box === m.id && folder === "inbox" && !fwd} dot="#2f6bff" label={m.name} count={m.unread} title={m.address ?? undefined} />)}
              {shared.length > 0 && <p className="mb-1 mt-3 px-[18px] text-[12px] font-semibold text-muted">Departments</p>}
              {shared.map((m) => <NavLink key={m.id} href={href({ box: m.id })} active={onList && box === m.id && folder === "inbox" && !fwd} dot={m.color ?? "#7b5cff"} label={m.name} count={m.unread} note={m.visibility === "everyone" ? "everyone" : undefined} title={m.address ?? undefined} />)}
              {other.map((m) => <NavLink key={m.id} href={href({ box: m.id })} active={onList && box === m.id && folder === "inbox"} dot="#8e8e93" label={m.name} count={m.unread} note="other addresses" />)}
              {data.forwarded.length > 0 && (
                <>
                  <p className="mb-1 mt-3 px-[18px] text-[12px] font-semibold text-muted">Forwarded to you</p>
                  {data.forwarded.map((f) => (
                    <NavLink key={f.address} href={href({ folder: "all", fwd: f.address })} active={onList && fwd === f.address} icon={<CornerUpRight className="size-[17px] text-[#c46a00]" />} label={f.address.split("@")[0].replace(/^./, (c) => c.toUpperCase())} count={f.unread} title={`Mail sent to ${f.address}, forwarded to you`} />
                  ))}
                </>
              )}
              <div className="mx-3.5 my-3 h-px bg-black/10 dark:bg-white/10" />
              {FOLDERS.map((f) => <NavLink key={f.id} href={href({ box: box === "all" ? null : box, folder: f.id })} active={onList && folder === f.id && !fwd && !tag} icon={<f.icon className="size-[18px]" />} label={f.label} count={f.id === "drafts" ? data.drafts : undefined} quiet={f.id === "drafts"} />)}
              <p className="mb-1 mt-3 px-[18px] text-[12px] font-semibold text-muted">Tags</p>
              {TAGS.map(([id, label, color]) => <NavLink key={id} href={href({ folder: "all", tag: id })} active={onList && tag === id} dot={color} square label={label} />)}
    </>
  );

  return (
    <ShellCtx.Provider value={ctx}>
      <div className={cn("bmail-root flex min-h-dvh flex-col text-text", data.backgroundDark && "bmail-on-dark", data.glassTint === "dark" && "dark")} style={style}>
        <header className="flex items-center gap-1.5 px-3 pb-1.5 pt-2.5 max-md:flex-wrap">
          <button type="button" onClick={toggleMenu} aria-label="Main menu" aria-expanded={deskMenu} className="inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10"><Menu className="size-5" /></button>
          <Link href="/mail" className="mr-4 shrink-0 md:mr-8 md:min-w-[140px]"><BLockup size={34} /></Link>
          <SearchBar inputRef={searchRef} box={box} />
          <span className="flex-1" />
          <button type="button" aria-label="Switch light and dark" onClick={() => setTheme(dark ? "light" : "dark")} className="inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10">{dark ? <Sun className="size-5" /> : <Moon className="size-5" />}</button>
          <button type="button" aria-label="Quick settings" aria-expanded={panel} onClick={() => setPanel((v) => !v)} className={cn("inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10", panel && "bg-black/[0.07] dark:bg-white/10")}><SlidersHorizontal className="size-5" /></button>
          <Link href="/apps" aria-label="BuPulse services" title="BuPulse services" className="inline-flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-black/5 max-sm:hidden dark:hover:bg-white/10"><LayoutGrid className="size-5" /></Link>
          <AccountMenu name={data.me.name} email={data.me.email} initial={data.me.initial} isAdmin={data.me.isAdmin} role={data.me.role} photo={data.me.photo} />
        </header>

        <div className="flex flex-1 items-start gap-2 px-2 pb-3 pr-3 max-md:pr-2">
          {phoneMenu && <button type="button" aria-label="Close the menu" onClick={() => setPhoneMenu(false)} className="fixed inset-0 z-30 cursor-default bg-black/25 md:hidden" />}
          {(deskMenu || phoneMenu) && (
            <nav aria-label="Mailboxes and folders" className={cn("bmail-menu bmail-slide sticky top-2 flex w-[256px] shrink-0 flex-col gap-0.5 pb-4 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-[280px] max-md:overflow-y-auto max-md:bg-white/95 max-md:p-3 max-md:shadow-2xl max-md:backdrop-blur-xl max-md:dark:bg-[#18181d]/95", !phoneMenu && "max-md:hidden", !deskMenu && "md:hidden")}>{navBody}</nav>
          )}
          {sheet && (
            <>
              <button type="button" aria-label="Close the menu" onClick={() => setSheet(false)} className="fixed inset-0 z-[65] cursor-default bg-black/25" />
              <nav aria-label="Mailboxes and folders" className="bmail-sheet bmail-slide fixed inset-y-0 left-0 z-[70] flex w-[280px] flex-col gap-0.5 overflow-y-auto bg-white/95 p-3 shadow-2xl backdrop-blur-xl dark:bg-[#18181d]/95">{navBody}</nav>
            </>
          )}
          <main className="min-w-0 flex-1">{children}</main>
          {panel && <QuickSettings data={data} glass={glass} onGlass={setGlass} onClose={() => setPanel(false)} />}
        </div>

        <NewMailNotices unread={data.mailboxes.reduce((n, m) => n + m.unread, 0)} />
        {compose && <Composer init={compose} onClose={() => setCompose(null)} />}
        {undo && (
          <div role="status" className="bmail-pop fixed bottom-6 left-6 z-50 flex items-center gap-4 rounded-2xl bg-[rgba(29,29,31,0.94)] py-3 pl-5 pr-3 text-[14px] text-white shadow-2xl backdrop-blur-xl">
            {undo.left > 0 ? `Sending in ${undo.left} s` : "Sent"}
            {undo.left > 0 && (
              <button type="button" onClick={async () => { const id = undo.id; setUndo(null); const r = await undoSendAction(id); if (r.ok) router.push("/mail?folder=drafts"); }} className="h-8 cursor-pointer rounded-lg px-3 font-semibold text-[#9dbbff] hover:bg-white/10">Undo</button>
            )}
          </div>
        )}
      </div>
    </ShellCtx.Provider>
  );
}

/** The search pill with Gmail-like search options (from, to, subject, words, dates, attachment, unread). */
function SearchBar({ inputRef, box }: { inputRef: React.RefObject<HTMLInputElement | null>; box: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const go = (form: HTMLFormElement) => {
    const f = new FormData(form);
    const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v);
    const parts = (["from", "to", "subject", "after", "before"] as const)
      .map((k) => [k, String(f.get(k) ?? "").trim()] as const)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}:${quote(v)}`);
    if (f.get("attach")) parts.push("has:attachment");
    if (f.get("unread")) parts.push("is:unread");
    const words = String(f.get("words") ?? "").trim();
    if (words) parts.push(words);
    const q = parts.join(" ");
    const p = new URLSearchParams();
    if (box !== "all") p.set("box", box);
    if (q) p.set("q", q);
    setOpen(false);
    if (inputRef.current) inputRef.current.value = q;
    router.push(`/mail${p.size ? `?${p}` : ""}`);
  };
  const field = "h-10 w-full rounded-xl border border-black/12 bg-white/90 px-3 text-[14.5px] outline-none focus:border-[#2f6bff] dark:border-white/15 dark:bg-white/5";
  return (
    <div ref={wrap} className="relative flex max-w-[760px] flex-[1_1_380px] max-md:order-last max-md:basis-full">
      <form action="/mail" className="flex h-12 w-full items-center gap-3 rounded-full border border-white/70 bg-[rgba(var(--bmail-rgb,255,255,255),var(--bmail-a))] pl-4 pr-1.5 backdrop-blur-xl dark:border-white/10 dark:bg-[rgba(40,40,46,var(--bmail-a))]">
        <Search className="size-5 shrink-0 text-muted" aria-hidden />
        {box !== "all" && <input type="hidden" name="box" value={box} />}
        <label className="sr-only" htmlFor="mail-q">Search mail</label>
        <input id="mail-q" ref={inputRef} type="search" name="q" defaultValue={sp.get("q") ?? ""} placeholder="Search mail" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted" />
        <button type="button" aria-label="Search options" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-black/[0.06] dark:hover:bg-white/10"><SlidersHorizontal className="size-[18px]" /></button>
      </form>
      {open && (
        <form onSubmit={(e) => { e.preventDefault(); go(e.currentTarget); }} aria-label="Search options" className="bmail-pop absolute left-0 right-0 top-14 z-50 grid text-[#1d1d1f] [text-shadow:none] dark:text-white grid-cols-[110px_1fr] items-center gap-x-3 gap-y-2.5 rounded-[22px] border border-white/80 bg-white/95 p-5 text-[14px] shadow-[0_24px_60px_-24px_rgba(15,23,42,0.5)] backdrop-blur-2xl max-sm:grid-cols-1 dark:border-white/10 dark:bg-[#1c1c22]/95">
          <label htmlFor="so-from" className="font-medium text-[#3c3c43] dark:text-white/75">From</label><input id="so-from" name="from" className={field} />
          <label htmlFor="so-to" className="font-medium text-[#3c3c43] dark:text-white/75">To</label><input id="so-to" name="to" className={field} />
          <label htmlFor="so-sub" className="font-medium text-[#3c3c43] dark:text-white/75">Subject</label><input id="so-sub" name="subject" className={field} />
          <label htmlFor="so-words" className="font-medium text-[#3c3c43] dark:text-white/75">Has the words</label><input id="so-words" name="words" className={field} />
          <span className="font-medium text-[#3c3c43] dark:text-white/75">Date</span>
          <span className="flex items-center gap-2"><input aria-label="After" type="date" name="after" className={field} /><span className="font-medium text-[#3c3c43] dark:text-white/75">to</span><input aria-label="Before" type="date" name="before" className={field} /></span>
          <span />
          <span className="flex flex-wrap gap-4">
            <label className="inline-flex cursor-pointer items-center gap-2"><input type="checkbox" name="attach" className="size-4 accent-[#1f5ae6]" />Has attachment</label>
            <label className="inline-flex cursor-pointer items-center gap-2"><input type="checkbox" name="unread" className="size-4 accent-[#1f5ae6]" />Unread only</label>
          </span>
          <span />
          <span className="flex justify-end gap-2 pt-1">
            <button type="reset" className="h-10 cursor-pointer rounded-full px-4 font-semibold text-muted hover:bg-black/5">Clear</button>
            <button className="h-10 cursor-pointer rounded-full bg-[#1f5ae6] px-6 font-semibold text-white hover:bg-[#1a4fd0]">Search</button>
          </span>
        </form>
      )}
    </div>
  );
}

/** Quick settings (design "Main"): Light / Dark / Auto, background, Random, own photo, glass. */
function QuickSettings({ data, glass, onGlass, onClose }: { data: ShellData; glass: number; onGlass: (n: number) => void; onClose: () => void }) {
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [bg, setBg] = useState(data.background);
  const [, start] = useTransition();
  const save = (look: { background?: string; glass?: number }) => start(async () => { await setMailLook(look); router.refresh(); });
  const pick = (id: string) => { setBg(id); save({ background: id }); };
  const label = (bg === RANDOM_BACKGROUND ? "Random" : bg === "photo" ? "Your photo" : MAIL_BACKGROUNDS.find((b) => b.id === bg)?.name) ?? data.backgroundName;
  const thumb = "relative h-[58px] cursor-pointer rounded-xl transition hover:scale-[1.04]";
  const ring = (on: boolean) => (on ? "ring-2 ring-[#4c8dff] ring-offset-2 ring-offset-white dark:ring-offset-[#1c1c22]" : "ring-1 ring-inset ring-black/10");
  return (
    <aside aria-label="Quick settings" className="bmail-slide-left sticky top-2 flex w-[300px] shrink-0 flex-col gap-5 rounded-[24px] border border-white/75 bg-[rgba(var(--bmail-rgb,255,255,255),var(--bmail-strong))] p-5 shadow-[0_20px_50px_-30px_rgba(15,23,42,0.5)] backdrop-blur-[var(--bmail-blur)] max-lg:fixed max-lg:inset-y-2 max-lg:right-2 max-lg:z-40 max-lg:overflow-y-auto dark:border-white/10 dark:bg-[rgba(30,30,36,var(--bmail-strong))]">
      <div className="flex items-center"><h2 className="flex-1 text-[17px] font-semibold">Quick settings</h2><button type="button" aria-label="Close quick settings" onClick={onClose} className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10"><X className="size-[18px]" /></button></div>
      <Link href="/mail/settings" className="-mt-3 inline-flex h-10 items-center justify-center rounded-full border border-black/12 text-[14px] font-semibold text-[#1f5ae6] hover:bg-black/[0.04] dark:border-white/15 dark:text-[#8fb4ff]">See all settings</Link>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">Appearance</span>
        <div role="radiogroup" aria-label="Appearance" className="flex gap-1 rounded-xl bg-black/[0.06] p-1 dark:bg-white/10">
          {([["light", "Light"], ["dark", "Dark"], ["system", "Auto"]] as const).map(([id, name]) => (
            <button key={id} type="button" role="radio" aria-checked={theme === id} onClick={() => setTheme(id)} className={cn("h-[34px] flex-1 cursor-pointer rounded-[9px] text-[13px] font-semibold transition", theme === id ? "bg-white text-[#1d1d1f] shadow-[0_1px_3px_rgba(0,0,0,0.18)] dark:bg-white/20 dark:text-white" : "text-muted")}>{name}</button>
          ))}
        </div>
        <span className="text-[12.5px] text-muted">Auto follows your phone or computer.</span>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">Background <span className="font-normal text-muted">{label}</span></span>
        <div role="radiogroup" aria-label="Background" className="grid grid-cols-3 gap-2">
          {MAIL_BACKGROUNDS.map((b) => (
            <button key={b.id} type="button" role="radio" aria-checked={bg === b.id} aria-label={b.name} title={b.name} onClick={() => pick(b.id)} className={cn(thumb, ring(bg === b.id))} style={{ background: b.css }} />
          ))}
          <button type="button" role="radio" aria-checked={bg === RANDOM_BACKGROUND} aria-label="Random" title="Random: a Kigali scene each day" onClick={() => pick(RANDOM_BACKGROUND)} className={cn(thumb, "flex items-center justify-center bg-[conic-gradient(from_0deg,#ffd2b8,#bfd2ff,#b8e6c0,#d6c6ff,#ffd2b8)]", ring(bg === RANDOM_BACKGROUND))}><Shuffle className="size-5 text-[#1d1d1f]" /></button>
          {data.hasPhoto && <button type="button" role="radio" aria-checked={bg === "photo"} aria-label="Your photo" title="Your photo" onClick={() => pick("photo")} className={cn(thumb, "flex items-center justify-center bg-black/[0.06] text-[12px] font-semibold", ring(bg === "photo"))}>Photo</button>}
        </div>
        <Link href="/mail/settings#look" className="text-[13.5px] font-semibold text-[#1f5ae6] dark:text-[#8fb4ff]">Use your own photo</Link>
      </div>
      {data.canChangeGlass && (
        <label className="flex flex-col gap-2 text-[13px] font-semibold">
          Glass
          <input type="range" min={0} max={100} step={5} value={glass} onChange={(e) => onGlass(Number(e.target.value))} onPointerUp={(e) => save({ glass: Number(e.currentTarget.value) })} onKeyUp={(e) => save({ glass: Number(e.currentTarget.value) })} className="w-full accent-[#4c8dff]" />
          <span className="flex justify-between text-[12px] font-normal text-muted"><span>Clear</span><span>Frosted</span></span>
        </label>
      )}
    </aside>
  );
}

function NavLink({ href, active, icon, dot, square, label, count, note, title, quiet }: { href: string; active: boolean; icon?: ReactNode; dot?: string; square?: boolean; label: string; count?: number; note?: string; title?: string; quiet?: boolean }) {
  return (
    <Link href={href} title={title} aria-current={active ? "page" : undefined} className={cn("flex h-9 items-center gap-3.5 rounded-full pl-[18px] pr-3.5 text-[14px] transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.08]", active && "bg-[rgba(31,90,230,0.14)] font-bold text-[#102a6b] dark:bg-[rgba(122,162,255,0.24)] dark:text-[#e6eeff]")}>
      <span className="inline-flex w-5 justify-center">{icon ?? <span className={cn("inline-block size-2.5", square ? "rounded-[3px]" : "rounded-full")} style={{ background: dot }} />}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {note && <span className="text-[11px] font-normal text-muted">{note}</span>}
      {!!count && <span className={cn("text-[12.5px]", quiet ? "font-normal text-muted" : "font-semibold")}>{count}</span>}
    </Link>
  );
}

export const TAG_STYLE: Record<string, { label: string; color: string }> = Object.fromEntries(TAGS.map(([id, label, color]) => [id, { label, color }]));
export { Tag as TagIcon };
