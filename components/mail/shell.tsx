"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Archive, File, Inbox, Menu, Moon, OctagonAlert, Pencil, Search, Send, Star, Sun, Tag, Trash2 } from "lucide-react";
import { useTheme } from "@/components/theme";
import { cn } from "@/lib/cn";
import { BLockup } from "./brand";
import { AccountMenu } from "./account-menu";
import { Composer, type ComposeInit } from "./composer";
import { loadDraftAction, undoSendAction } from "@/app/mail/(app)/actions";

export type NavMailbox = { id: string; name: string; address: string | null; kind: string; visibility: string; unread: number; color: string | null };
export type ShellData = {
  me: { name: string; email: string; isAdmin: boolean; initial: string; role: string };
  mailboxes: NavMailbox[];
  sendFrom: { id: string; label: string; address: string }[];
  signatureHtml: string;
  sendsLeft: number;
  background: string;
};

type Ctx = { compose: (init?: ComposeInit) => void; toastUndo: (messageId: string, seconds: number, count?: number) => void; data: ShellData };
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

export const BACKGROUNDS: Record<string, string> = {
  "kigali-hills": "bg-[url(/mail/backgrounds/kigali-hills.svg)] bg-cover bg-bottom",
  "kigali-night": "bg-[url(/mail/backgrounds/kigali-night.svg)] bg-cover bg-bottom",
  "kivu-beach": "bg-[url(/mail/backgrounds/kivu-beach.svg)] bg-cover bg-bottom",
  virunga: "bg-[url(/mail/backgrounds/virunga.svg)] bg-cover bg-bottom",
  plain: "bg-[#f3f4f7] dark:bg-[#121214]",
};

export function MailShell({ data, children }: { data: ShellData; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(true);
  const [compose, setCompose] = useState<ComposeInit | null>(null);
  const [undo, setUndo] = useState<{ id: string; left: number; count: number } | null>(null);
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const box = sp.get("box") ?? "all";
  const folder = sp.get("folder") ?? "inbox";
  const tag = sp.get("tag");
  const { resolvedTheme, setTheme } = useTheme();
  const searchRef = useRef<HTMLInputElement>(null);

  const toastUndo = useCallback((id: string, seconds: number, count = 1) => setUndo({ id, left: seconds, count }), []);
  // A draft opened from the Drafts folder (/mail?draft=<id>, via the conversation page) opens in the composer.
  const draftParam = sp.get("draft");
  useEffect(() => {
    if (!draftParam) return;
    void loadDraftAction(draftParam).then((init) => init && setCompose(init));
    const p = new URLSearchParams(window.location.search);
    p.delete("draft");
    router.replace(`/mail${p.size ? `?${p}` : ""}`, { scroll: false });
  }, [draftParam, router]);
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

  const ctx = useMemo<Ctx>(() => ({ compose: (init) => setCompose(init ?? {}), toastUndo, data }), [toastUndo, data]);
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

  return (
    <ShellCtx.Provider value={ctx}>
      <div className={cn("flex min-h-dvh flex-col text-text", BACKGROUNDS[data.background] ?? BACKGROUNDS["kigali-hills"])}>
        <div className="flex min-h-dvh flex-col bg-transparent dark:bg-[rgba(8,8,12,0.55)]">
          <header className="flex flex-wrap items-center gap-2 px-3 pb-1.5 pt-2.5">
            <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu" className="inline-flex size-10 cursor-pointer items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10"><Menu className="size-5" /></button>
            <Link href="/mail" className="mr-6 min-w-[150px]"><BLockup size={34} /></Link>
            <form action="/mail" className="flex h-12 max-w-[760px] flex-[1_1_380px] items-center gap-3 rounded-full border border-white/70 bg-white/65 px-4 backdrop-blur-xl dark:border-white/10 dark:bg-[rgba(40,40,46,0.6)]">
              <Search className="size-5 text-muted" aria-hidden />
              {box !== "all" && <input type="hidden" name="box" value={box} />}
              <label className="sr-only" htmlFor="mail-q">Search mail</label>
              <input id="mail-q" ref={searchRef} name="q" defaultValue={sp.get("q") ?? ""} placeholder="Search mail (from:irembo, has:attachment)" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted" />
            </form>
            <span className="flex-1" />
            <span className="hidden text-[12.5px] text-muted md:inline">{data.sendsLeft} of 100 sends left today</span>
            <button type="button" aria-label="Light or dark" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} className="inline-flex size-10 cursor-pointer items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10">{resolvedTheme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}</button>
            {data.me.isAdmin && <Link href="/mail/console" className="hidden h-9 items-center rounded-full px-3 text-[13px] font-semibold hover:bg-black/5 sm:inline-flex dark:hover:bg-white/10">Console</Link>}
            <AccountMenu name={data.me.name} email={data.me.email} initial={data.me.initial} isAdmin={data.me.isAdmin} role={data.me.role} />
          </header>

          <div className="flex flex-1 items-start gap-2 px-2 pb-3 pr-3">
            {menuOpen && (
              <nav aria-label="Mailboxes and folders" className="sticky top-2 flex w-[248px] shrink-0 flex-col gap-0.5 pb-4 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-[270px] max-md:overflow-y-auto max-md:bg-white/95 max-md:p-3 max-md:shadow-2xl max-md:backdrop-blur-xl max-md:dark:bg-[#18181d]/95">
                <button type="button" onClick={() => setCompose({})} className="mb-3 ml-1 mt-1 inline-flex h-14 w-fit cursor-pointer items-center gap-3.5 rounded-[18px] border border-white/80 bg-white/85 pl-[18px] pr-6 text-[15px] font-semibold shadow-[0_8px_24px_-12px_rgba(0,0,0,0.35)] backdrop-blur-xl transition hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.45)] dark:border-white/10 dark:bg-[rgba(48,48,56,0.9)]"><Pencil className="size-5" />Compose</button>
                <NavLink href={href({ folder: "inbox" })} active={onList && box === "all" && folder === "inbox" && !tag} icon={<Inbox className="size-[18px]" />} label="All inboxes" count={allUnread} />
                {personal.map((m) => <NavLink key={m.id} href={href({ box: m.id })} active={onList && box === m.id && folder === "inbox"} dot="#2f6bff" label={m.name} count={m.unread} title={m.address ?? undefined} />)}
                {shared.length > 0 && <p className="mb-1 mt-3 px-[18px] text-[12px] font-semibold text-muted">Departments</p>}
                {shared.map((m) => <NavLink key={m.id} href={href({ box: m.id })} active={onList && box === m.id && folder === "inbox"} dot={m.color ?? "#7b5cff"} label={m.name} count={m.unread} note={m.visibility === "everyone" ? "everyone" : undefined} title={m.address ?? undefined} />)}
                {other.map((m) => <NavLink key={m.id} href={href({ box: m.id })} active={onList && box === m.id && folder === "inbox"} dot="#8e8e93" label={m.name} count={m.unread} note="other addresses" />)}
                <div className="mx-3.5 my-3 h-px bg-black/10 dark:bg-white/10" />
                {FOLDERS.map((f) => <NavLink key={f.id} href={href({ box: box === "all" ? null : box, folder: f.id })} active={onList && folder === f.id} icon={<f.icon className="size-[18px]" />} label={f.label} />)}
                <p className="mb-1 mt-3 px-[18px] text-[12px] font-semibold text-muted">Tags</p>
                {TAGS.map(([id, label, color]) => <NavLink key={id} href={href({ folder: "all", tag: id })} active={onList && tag === id} dot={color} square label={label} />)}
              </nav>
            )}
            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </div>

        {compose && <Composer key={compose.draftId ?? "new"} init={compose} onClose={() => setCompose(null)} />}
        {undo && (
          <div role="status" className="bmail-pop fixed bottom-6 left-6 z-50 flex items-center gap-4 rounded-2xl bg-[rgba(29,29,31,0.94)] py-3 pl-5 pr-3 text-[14px] text-white shadow-2xl backdrop-blur-xl">
            {undo.left > 0 ? `Sending${undo.count > 1 ? ` ${undo.count} emails` : ""} in ${undo.left} s` : undo.count > 1 ? `${undo.count} emails sent` : "Sent"}
            {undo.left > 0 && (
              <button type="button" onClick={async () => { const id = undo.id; setUndo(null); const r = await undoSendAction(id); const init = r.draftId ? await loadDraftAction(r.draftId) : null; if (init) setCompose(init); router.refresh(); }} className="h-8 cursor-pointer rounded-lg px-3 font-semibold text-[#9dbbff] hover:bg-white/10">Undo</button>
            )}
          </div>
        )}
      </div>
    </ShellCtx.Provider>
  );
}

function NavLink({ href, active, icon, dot, square, label, count, note, title }: { href: string; active: boolean; icon?: ReactNode; dot?: string; square?: boolean; label: string; count?: number; note?: string; title?: string }) {
  return (
    <Link href={href} title={title} aria-current={active ? "page" : undefined} className={cn("flex h-9 items-center gap-3.5 rounded-full pl-[18px] pr-3.5 text-[14px] transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.08]", active && "bg-[rgba(31,90,230,0.14)] font-bold text-[#102a6b] dark:bg-[rgba(122,162,255,0.24)] dark:text-[#e6eeff]")}>
      <span className="inline-flex w-5 justify-center">{icon ?? <span className={cn("inline-block size-2.5", square ? "rounded-[3px]" : "rounded-full")} style={{ background: dot }} />}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {note && <span className="text-[11px] font-normal text-muted">{note}</span>}
      {!!count && <span className="text-[12.5px] font-semibold">{count}</span>}
    </Link>
  );
}

export const TAG_STYLE: Record<string, { label: string; color: string }> = Object.fromEntries(TAGS.map(([id, label, color]) => [id, { label, color }]));
export { Tag as TagIcon };
