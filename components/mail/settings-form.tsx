"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState, useSyncExternalStore, useTransition } from "react";
import { ArrowLeft, BellRing, CornerUpRight, Info, Moon, Shuffle, Sun } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import { useTheme } from "@/components/theme";
import { cn } from "@/lib/cn";
import { formatPhone } from "@/lib/phone";
import { MAIL_BACKGROUNDS, RANDOM_BACKGROUND, swatchCss } from "@/lib/mail/backgrounds";
import { SIGNATURE_LOOKS, signatureHtmlFor, withPhoto, type SignatureCompany } from "@/lib/mail/signature-render";
import { changeMailPassword, saveProfile, setMailLook, setMailPref, type ProfileState } from "@/app/mail/(app)/actions";
import { NewPasswordForm } from "./auth";
import { BackgroundUpload, PhotoPicker } from "./photo-picker";
import { showBackground, useMail } from "./shell";

// Settings (design "Settings"): General (photo, password, reading), Look and signature (appearance, background,
// signature look and lines with a live preview), Notifications (new mail in this browser).

export type SettingsProps = {
  profile: { name: string; title: string; phone: string; extra: string; background: string; email: string; look: string; photo: string | null; photoInSignature: boolean };
  company: SignatureCompany;
  forwards: string[];
  hasBackgroundPhoto: boolean;
};

type Tab = "general" | "look" | "notifications";
const TABS: [Tab, string][] = [["general", "General"], ["look", "Look and signature"], ["notifications", "Notifications"]];
const card = "bmail-glass rounded-[24px] p-6 [--bmail-a:var(--bmail-strong)]";
const input = "h-12 w-full rounded-2xl border border-black/15 bg-white px-4 text-[16px] outline-none focus:border-[#2f6bff] focus:ring-2 focus:ring-[#2f6bff]/25 dark:border-white/15 dark:bg-white/5";
const label = "flex flex-col gap-2 text-[13.5px] font-semibold";

export function SettingsForm(props: SettingsProps) {
  // The open tab follows the address (#look, #notifications), so "Use your own photo" can link straight to it.
  const hash = useSyncExternalStore(hashStore.subscribe, hashStore.get, () => "");
  const tab: Tab = hash === "look" || hash === "signature" ? "look" : hash === "notifications" ? "notifications" : "general";
  const choose = (t: Tab) => { history.replaceState(null, "", `#${t}`); window.dispatchEvent(new HashChangeEvent("hashchange")); };
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3 px-1">
        <Link href="/mail" aria-label="Back to Mail" className="inline-flex size-10 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10"><ArrowLeft className="size-5" /></Link>
        <h1 className="text-[28px] font-bold tracking-[-0.025em]">Settings</h1>
        <span className="flex-1" />
        <div role="tablist" aria-label="Settings sections" className="flex gap-1 rounded-full bg-[rgba(255,255,255,var(--bmail-a))] p-1 backdrop-blur-xl dark:bg-[rgba(40,40,46,var(--bmail-a))]">
          {TABS.map(([id, name]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => choose(id)} className={cn("h-9 cursor-pointer rounded-full px-4 text-[13.5px] font-semibold transition", tab === id ? "bg-[#1f5ae6] text-white" : "hover:bg-black/[0.06] dark:hover:bg-white/10")}>{name}</button>
          ))}
        </div>
      </header>
      {tab === "general" && <General {...props} />}
      {tab === "look" && <LookAndSignature {...props} />}
      {tab === "notifications" && <Notifications />}
    </div>
  );
}

function General({ profile }: SettingsProps) {
  const [open, setOpen] = useState(false);
  const full = useSyncExternalStore(readMode.subscribe, readMode.get, () => false);
  return (
    <>
      <section id="photo" className={card} aria-labelledby="ph">
        <h2 id="ph" className="mb-1 text-[18px] font-semibold">Your photo</h2>
        <p className="mb-5 text-[13.5px] text-muted">People you write to see your face next to your emails in B Mail, and in your signature if you switch it on.</p>
        <PhotoPicker name={profile.name} photo={profile.photo} />
      </section>
      <section id="password" aria-labelledby="pwh" className={card}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex-1">
            <h2 id="pwh" className="text-[18px] font-semibold">Password and sign-in</h2>
            <p className="text-[13.5px] text-muted">You sign in with your authenticator code, or your password and then the code. Lost your phone? Your mail admin can reset your authenticator.</p>
          </span>
          {!open && <button type="button" onClick={() => setOpen(true)} className="h-10 cursor-pointer rounded-full border border-black/15 px-5 text-[14px] font-semibold hover:bg-black/5 dark:border-white/15">Change password</button>}
        </div>
        {open && <div className="mt-4 max-w-[420px]"><NewPasswordForm action={changeMailPassword} label="Save new password" /></div>}
      </section>
      <section className={card} aria-labelledby="rd">
        <h2 id="rd" className="mb-3 text-[18px] font-semibold">Reading</h2>
        <div role="radiogroup" aria-label="Open emails" className="grid gap-3 sm:grid-cols-2">
          {([[false, "In the frame", "The menu stays on the left."], [true, "Full screen", "10px margins and a comfortable text width. Return goes back."]] as const).map(([v, name, note]) => (
            <button key={name} type="button" role="radio" aria-checked={full === v} onClick={() => readMode.set(v)} className={cn("flex cursor-pointer flex-col items-start gap-1 rounded-2xl border p-4 text-left transition", full === v ? "border-[#1f5ae6] bg-[rgba(31,90,230,0.08)]" : "border-black/12 hover:bg-black/[0.03] dark:border-white/15")}>
              <span className="text-[15px] font-semibold">{name}</span><span className="text-[13px] text-muted">{note}</span>
            </button>
          ))}
        </div>
        <p className="mt-4 text-[13px] text-muted">Keyboard: <b>c</b> write, <b>/</b> search, <b>j</b> / <b>k</b> next and previous, <b>e</b> archive, <b>#</b> delete, <b>s</b> star, <b>u</b> back to the list, <b>⌘ Enter</b> send.</p>
      </section>
    </>
  );
}

function LookAndSignature({ profile, company, forwards, hasBackgroundPhoto }: SettingsProps) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [state, action, pending] = useActionState<ProfileState, FormData>(saveProfile, {});
  const [bg, setBg] = useState(profile.background || "kigali-hills");
  const [look, setLook] = useState(profile.look);
  const [name, setName] = useState(profile.name);
  const [title, setTitle] = useState(profile.title);
  const [phone, setPhone] = useState(profile.phone);
  const [extra, setExtra] = useState(profile.extra);
  const [withMyPhoto, setWithMyPhoto] = useState(profile.photoInSignature);
  const [, start] = useTransition();
  const { data: shell } = useMail();
  // Paints at once; the save runs behind it (the server action refreshes the page when it is done).
  const pickBg = (id: string) => { setBg(id); showBackground(id, shell.background); start(async () => { await setMailLook({ background: id }); }); };
  const mobile = phone ? formatPhone(phone) : null;
  const preview = withPhoto(signatureHtmlFor(look, company, { name: name || profile.name, title: title || null, email: profile.email, mobile: mobile || null, extra: extra || null }), withMyPhoto ? profile.photo : null, name);
  const thumb = "flex h-24 cursor-pointer items-end rounded-2xl p-2 transition hover:-translate-y-0.5";
  const ring = (on: boolean) => (on ? "ring-2 ring-[#1f5ae6] ring-offset-2 ring-offset-white dark:ring-offset-[#1c1c22]" : "ring-1 ring-black/10");
  return (
    <form action={action} className="flex flex-col gap-4">
      <section id="look" className={card} aria-labelledby="ap">
        <h2 id="ap" className="mb-3 text-[18px] font-semibold">Appearance</h2>
        <div role="radiogroup" aria-label="Appearance" className="flex w-full max-w-[420px] gap-1 rounded-xl bg-black/[0.06] p-1 dark:bg-white/10">
          {([["light", "Light", Sun], ["dark", "Dark", Moon], ["system", "Auto", null]] as const).map(([id, n, Icon]) => (
            <button key={id} type="button" role="radio" aria-checked={theme === id} onClick={() => setTheme(id)} className={cn("inline-flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-[10px] text-[14px] font-semibold", theme === id ? "bg-white shadow-[0_1px_3px_rgba(0,0,0,0.18)] dark:bg-white/20" : "text-muted")}>{Icon && <Icon className="size-4" />}{n}</button>
          ))}
        </div>
        <p className="mt-2 text-[13px] text-muted">Auto follows your phone or computer. Dark mode puts a soft dark layer over any background.</p>
        <h2 className="mb-3 mt-6 text-[18px] font-semibold">Background <span className="text-[14px] font-normal text-muted">{bg === RANDOM_BACKGROUND ? "Random" : bg === "photo" ? "Your photo" : MAIL_BACKGROUNDS.find((b) => b.id === bg)?.name}</span></h2>
        <input type="hidden" name="background" value={bg === "photo" ? "kigali-hills" : bg} />
        <div role="radiogroup" aria-label="Background" className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {MAIL_BACKGROUNDS.map((b) => (
            <button key={b.id} type="button" role="radio" aria-checked={bg === b.id} aria-label={b.name} onClick={() => pickBg(b.id)} className={cn(thumb, ring(bg === b.id))} style={{ background: swatchCss(b) }}>
              <span className="rounded-lg bg-white/85 px-2 py-0.5 text-[12px] font-semibold text-[#1d1d1f]">{b.name}</span>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={bg === RANDOM_BACKGROUND} aria-label="Random" onClick={() => pickBg(RANDOM_BACKGROUND)} className={cn(thumb, "relative bg-[conic-gradient(from_0deg,#ffd2b8,#bfd2ff,#b8e6c0,#d6c6ff,#ffd2b8)]", ring(bg === RANDOM_BACKGROUND))}>
            <Shuffle className="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-[#1d1d1f]" /><span className="rounded-lg bg-white/85 px-2 py-0.5 text-[12px] font-semibold text-[#1d1d1f]">Random</span>
          </button>
          {hasBackgroundPhoto && (
            <button type="button" role="radio" aria-checked={bg === "photo"} aria-label="Your photo" onClick={() => pickBg("photo")} className={cn(thumb, "bg-black/[0.06]", ring(bg === "photo"))}><span className="rounded-lg bg-white/85 px-2 py-0.5 text-[12px] font-semibold text-[#1d1d1f]">Your photo</span></button>
          )}
          <BackgroundUpload onDone={() => { setBg("photo"); router.refresh(); }} />
        </div>
        <p className="mt-3 text-[13px] text-muted">Your own photo is made smaller (about 300 KB) and counts toward your storage. Only you see your background.</p>
        {forwards.map((f) => (
          <p key={f} className="mt-3 flex items-start gap-2.5 rounded-2xl bg-[#fff4e5] px-4 py-3 text-[13.5px] text-[#6b3a00] dark:bg-[rgba(255,170,60,0.15)] dark:text-[#ffd29a]">
            <CornerUpRight className="mt-0.5 size-4 shrink-0" /><span>Mail to <strong>{f}</strong> is also delivered to <strong>{profile.email}</strong>. Set by your admin.</span>
          </p>
        ))}
      </section>

      <section id="signature" className={card} aria-labelledby="sig">
        <h2 id="sig" className="mb-3 text-[18px] font-semibold">Signature</h2>
        <input type="hidden" name="signatureTemplate" value={look} />
        <div role="radiogroup" aria-label="Signature look" className="mb-5 flex flex-wrap gap-2">
          {SIGNATURE_LOOKS.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={look === l.id} onClick={() => setLook(l.id)} className={cn("h-10 cursor-pointer rounded-full border px-4 text-[14px] font-semibold transition", look === l.id ? "border-[#1f5ae6] bg-[#1f5ae6] text-white" : "border-black/15 hover:bg-black/5 dark:border-white/15")}>{l.name}</button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className={label}>Name<input name="name" value={name} onChange={(e) => setName(e.target.value)} required className={input} /></label>
          <label className={label}>Job title<input name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Founder" className={input} /></label>
          <div className={`${label} md:col-span-2`}><span>Personal phone (optional)</span><PhoneInput name="phone" value={phone} onChange={setPhone} placeholder="720 123 456" countryLabel="Country" /><span className="text-[12.5px] font-normal text-muted">Shown as &ldquo;Mobile&rdquo; in your signature. Leave it empty to show only the company number.</span></div>
          <div className="flex items-center gap-3 rounded-2xl bg-black/[0.04] px-4 py-3 text-[14px] md:col-span-2 dark:bg-white/[0.06]">
            <span className="flex-1"><span className="block text-[12.5px] text-muted">Company phone, in every signature</span><strong className="text-[16px]">{company.companyPhone || "Not set yet"}</strong></span><span className="text-[12.5px] text-muted">Set by your admin</span>
          </div>
          <label className={`${label} md:col-span-2`}>Extra line (optional)<input name="signatureExtra" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. Available Mon to Sat, 8:00 to 18:00" className={input} /></label>
          {profile.photo && (
            <label className="flex cursor-pointer items-center gap-3 text-[14px] font-semibold md:col-span-2">
              <input type="checkbox" checked={withMyPhoto} onChange={(e) => { setWithMyPhoto(e.target.checked); start(async () => { await setMailPref("photoInSignature", e.target.checked); }); }} className="size-5 accent-[#1f5ae6]" />Put my photo in my signature
            </label>
          )}
        </div>
        <p className="mt-4 flex items-start gap-2 text-[13px] text-muted"><Info className="mt-0.5 size-4 shrink-0" />Logo, website, address, LinkedIn, Instagram, Facebook and the quote button are set by your admin.</p>
        <div aria-label="Preview" className="mt-4 overflow-x-auto rounded-2xl bg-white p-5 text-[#0f172a] shadow-[inset_0_0_0_1px_rgba(60,60,67,0.12)]" dangerouslySetInnerHTML={{ __html: preview }} />
        <div className="mt-5 flex items-center gap-3">
          <button disabled={pending} className="h-12 cursor-pointer rounded-full bg-[#1f5ae6] px-7 text-[15px] font-semibold text-white hover:bg-[#1a4fd0] disabled:opacity-60">{pending ? "Saving…" : "Save"}</button>
          {state.ok && <span role="status" className="text-[14px] font-medium text-[#11633a]">{state.ok}</span>}
          {state.error && <span role="alert" className="text-[14px] font-medium text-[#b42318]">{state.error}</span>}
        </div>
      </section>
    </form>
  );
}

/** New mail in this browser: a notice (and a soft sound) while B Mail is open in a tab. Kept in this browser only. */
function Notifications() {
  const on = useSyncExternalStore(notify.subscribe, notify.get, () => false);
  const [perm, setPerm] = useState<string>(() => (typeof window !== "undefined" && "Notification" in window ? Notification.permission : "default"));
  const toggle = async () => {
    if (on) return notify.set(false);
    if (!("Notification" in window)) return setPerm("unsupported");
    const p = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    setPerm(p);
    if (p === "granted") notify.set(true);
  };
  return (
    <section className={card} aria-labelledby="nt">
      <h2 id="nt" className="mb-1 text-[18px] font-semibold">New mail</h2>
      <p className="mb-5 text-[13.5px] text-muted">While B Mail is open in a tab, show a notice when new mail arrives in your inboxes.</p>
      <label className="flex cursor-pointer items-center gap-4 rounded-2xl border border-black/12 p-4 dark:border-white/15">
        <BellRing className="size-6 text-[#1f5ae6]" />
        <span className="flex flex-1 flex-col"><span className="text-[15px] font-semibold">Notices in this browser</span><span className="text-[13px] text-muted">{perm === "denied" ? "Blocked in this browser: allow notifications for bupulse.com in the browser settings." : perm === "unsupported" ? "This browser cannot show notices." : on ? "On for this browser." : "Off."}</span></span>
        <button type="button" role="switch" aria-checked={on} aria-label="Notices in this browser" onClick={toggle} className={cn("relative h-7 w-12 cursor-pointer rounded-full transition", on ? "bg-[#34c759]" : "bg-black/20 dark:bg-white/20")}><span className={cn("absolute top-0.5 size-6 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} /></button>
      </label>
    </section>
  );
}

/** Small per-browser switches (reading mode, notices): useSyncExternalStore over localStorage. */
function localSwitch(key: string, onValue: string) {
  const ev = `bmail:${key}`;
  return {
    get: () => { try { return localStorage.getItem(key) === onValue; } catch { return false; } },
    set: (v: boolean) => { try { localStorage.setItem(key, v ? onValue : "off"); } catch { /* private window */ } window.dispatchEvent(new Event(ev)); },
    subscribe: (cb: () => void) => { window.addEventListener(ev, cb); window.addEventListener("storage", cb); return () => { window.removeEventListener(ev, cb); window.removeEventListener("storage", cb); }; },
  };
}
const readMode = localSwitch("bmail-read", "full");
const hashStore = {
  get: () => window.location.hash.replace("#", ""),
  subscribe: (cb: () => void) => { window.addEventListener("hashchange", cb); return () => window.removeEventListener("hashchange", cb); },
};
export const notify = localSwitch("bmail-notify", "on");
