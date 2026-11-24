"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { Check, ChevronDown, Moon, Shuffle, Sun } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import { useTheme } from "@/components/theme";
import { cn } from "@/lib/cn";
import { formatPhone } from "@/lib/phone";
import { MAIL_BACKGROUNDS, RANDOM_BACKGROUND, swatchCss } from "@/lib/mail/backgrounds";
import { SIGNATURE_LOOKS, signatureHtmlFor, withPhoto, type SignatureCompany } from "@/lib/mail/signature-render";
import { saveProfile, setMailLook, setMailPref, type ProfileState } from "@/app/mail/(app)/actions";
import { BMark } from "./brand";
import { PhotoPicker } from "./photo-picker";
import { Avatar } from "./thread-list";

type Profile = { name: string; title: string; phone: string; email: string; look: string; photo: string | null; photoInSignature: boolean; background: string };
const STEPS = ["Your photo", "Signature", "Look"] as const;
const input = "h-12 w-full rounded-2xl border border-black/15 bg-white px-4 text-[16px] outline-none focus:border-[#2f6bff] focus:ring-2 focus:ring-[#2f6bff]/25 dark:border-white/15 dark:bg-white/5";

export function WelcomeSteps({ profile, company }: { profile: Profile; company: SignatureCompany }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [step, setStep] = useState(0);
  const [photo, setPhoto] = useState(profile.photo);
  const [inSig, setInSig] = useState(profile.photoInSignature);
  const [guide, setGuide] = useState(false);
  const [name, setName] = useState(profile.name);
  const [title, setTitle] = useState(profile.title);
  const [phone, setPhone] = useState(profile.phone);
  const [look, setLook] = useState(profile.look);
  const [bg, setBg] = useState(profile.background);
  const [, start] = useTransition();
  const [sigState, sigAction, saving] = useActionState<ProfileState, FormData>(async (prev, fd) => {
    const r = await saveProfile(prev, fd);
    if (r.ok) setStep(2);
    return r;
  }, {});
  const first = name.split(" ")[0] || "there";
  const finish = () => start(async () => { await setMailPref("welcomed", true); router.push("/mail"); router.refresh(); });
  const preview = withPhoto(signatureHtmlFor(look, company, { name, title: title || null, email: profile.email, mobile: phone ? formatPhone(phone) : null, extra: null }), inSig ? photo : null, name);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8" style={{ background: "radial-gradient(1100px 700px at 8% -10%, #ffd2b8 0%, rgba(255,210,184,0) 60%), radial-gradient(900px 700px at 95% 0%, #bfd2ff 0%, rgba(191,210,255,0) 58%), radial-gradient(1100px 800px at 55% 110%, #d6c6ff 0%, rgba(214,198,255,0) 62%), #eef1f8" }}>
      <section aria-label="Set up your mail" className="bmail-pop flex w-full max-w-[760px] flex-col overflow-hidden rounded-[30px] border border-white/80 bg-white/[0.86] text-[#1d1d1f] shadow-[0_40px_90px_-40px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-[rgba(28,28,34,0.9)] dark:text-white">
        <header className="flex flex-wrap items-center gap-4 border-b border-black/[0.07] px-7 py-5 dark:border-white/10">
          <BMark size={40} className="text-[#010106] dark:text-white" />
          <ol aria-label="Steps" className="flex flex-1 flex-wrap items-center justify-end gap-2 text-[13px] font-semibold">
            {STEPS.map((s, i) => (
              <li key={s} aria-current={i === step ? "step" : undefined} className={cn("inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-3", i === step ? "bg-[rgba(31,90,230,0.1)] text-[#1f5ae6]" : i < step ? "text-[#11633a]" : "text-muted")}>
                <span className={cn("inline-flex size-6 items-center justify-center rounded-full text-[12px] text-white", i === step ? "bg-[#1f5ae6]" : i < step ? "bg-[#1a7f37]" : "bg-black/20 dark:bg-white/20")}>{i < step ? <Check className="size-3.5" /> : i + 1}</span>{s}
              </li>
            ))}
          </ol>
        </header>

        <div key={step} className="bmail-rise flex flex-col gap-5 px-7 py-6">
          {step === 0 && (
            <>
              <div><h1 className="text-[26px] font-bold tracking-[-0.02em]">Welcome, {first}. Add your photo.</h1><p className="mt-1 text-[15px] text-muted">People you write to will see your face next to your emails, in BuPulse and in Gmail.</p></div>
              <PhotoPicker name={name} photo={photo} onChange={setPhoto} />
              <div className="rounded-2xl bg-black/[0.04] p-4 dark:bg-white/[0.06]">
                <p className="mb-2 text-[12.5px] font-semibold text-muted">How people see you</p>
                <div className="flex items-center gap-3 rounded-xl bg-white px-3 py-2.5 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
                  <Avatar who={name} initial={name[0]?.toUpperCase() ?? "?"} photo={photo} size={32} />
                  <strong className="w-[150px] shrink-0 truncate">{name}</strong>
                  <span className="min-w-0 flex-1 truncate text-[#5c5c63]"><b className="text-[#1d1d1f]">Re: Your posts for this week</b> — They are live now, thank you…</span>
                  <span className="text-[12.5px] text-[#5c5c63]">09:02</span>
                </div>
              </div>
              {photo && (
                <label className="flex cursor-pointer items-center justify-between gap-3 text-[14.5px] font-semibold">
                  Put my photo in my signature
                  <button type="button" role="switch" aria-checked={inSig} aria-label="Put my photo in my signature" onClick={() => { const v = !inSig; setInSig(v); start(async () => { await setMailPref("photoInSignature", v); }); }} className={cn("relative h-7 w-12 cursor-pointer rounded-full transition", inSig ? "bg-[#34c759]" : "bg-black/20 dark:bg-white/20")}><span className={cn("absolute top-0.5 size-6 rounded-full bg-white shadow transition-all", inSig ? "left-[22px]" : "left-0.5")} /></button>
                </label>
              )}
              <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
                <button type="button" onClick={() => setGuide((v) => !v)} aria-expanded={guide} className="flex w-full cursor-pointer items-center gap-2 text-left text-[14.5px] font-semibold">Show this photo in Gmail too (free)<span className="flex-1" /><ChevronDown className={cn("size-4 transition", guide && "rotate-180")} /></button>
                {guide && (
                  <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[14px] text-muted">
                    <li>Make a free Google account with <strong className="text-text">{profile.email}</strong> (choose &ldquo;Use my current email address instead&rdquo;) at <a href="https://accounts.google.com/signup" target="_blank" rel="noreferrer" className="font-semibold text-[#1f5ae6]">accounts.google.com/signup</a>.</li>
                    <li>Google&apos;s code arrives here, in your B Mail inbox.</li>
                    <li>Add this same photo to that Google account and set it to &ldquo;Visible to anyone&rdquo;.</li>
                  </ol>
                )}
              </div>
            </>
          )}
          {step === 1 && (
            <form id="welcome-sig" action={sigAction} className="flex flex-col gap-4">
              <div><h1 className="text-[26px] font-bold tracking-[-0.02em]">Your signature</h1><p className="mt-1 text-[15px] text-muted">It goes under every email you send. Logo, website, address and the quote button come from your admin.</p></div>
              <input type="hidden" name="signatureTemplate" value={look} />
              <input type="hidden" name="background" value={bg === "photo" ? "kigali-hills" : bg} />
              <div role="radiogroup" aria-label="Signature look" className="flex flex-wrap gap-2">
                {SIGNATURE_LOOKS.map((l) => <button key={l.id} type="button" role="radio" aria-checked={look === l.id} onClick={() => setLook(l.id)} className={cn("h-10 cursor-pointer rounded-full border px-4 text-[14px] font-semibold", look === l.id ? "border-[#1f5ae6] bg-[#1f5ae6] text-white" : "border-black/15 hover:bg-black/5 dark:border-white/15")}>{l.name}</button>)}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-[13.5px] font-semibold">Name<input name="name" value={name} onChange={(e) => setName(e.target.value)} required className={input} /></label>
                <label className="flex flex-col gap-2 text-[13.5px] font-semibold">Job title<input name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Customer support" className={input} /></label>
                <div className="flex flex-col gap-2 text-[13.5px] font-semibold md:col-span-2"><span>Personal phone (optional)</span><PhoneInput name="phone" value={phone} onChange={setPhone} placeholder="720 123 456" countryLabel="Country" /></div>
              </div>
              <div aria-label="Preview" className="overflow-x-auto rounded-2xl bg-white p-5 text-[#0f172a] shadow-[inset_0_0_0_1px_rgba(60,60,67,0.12)]" dangerouslySetInnerHTML={{ __html: preview }} />
              {sigState.error && <p role="alert" className="rounded-xl bg-[#fdecec] px-3 py-2 text-[13.5px] font-medium text-[#b42318]">{sigState.error}</p>}
            </form>
          )}
          {step === 2 && (
            <>
              <div><h1 className="text-[26px] font-bold tracking-[-0.02em]">Make it yours</h1><p className="mt-1 text-[15px] text-muted">Light or dark, and the picture behind your mail. Only you see it; change it any time in Quick settings.</p></div>
              <div role="radiogroup" aria-label="Appearance" className="flex max-w-[420px] gap-1 rounded-xl bg-black/[0.06] p-1 dark:bg-white/10">
                {([["light", "Light", Sun], ["dark", "Dark", Moon], ["system", "Auto", null]] as const).map(([id, n, Icon]) => (
                  <button key={id} type="button" role="radio" aria-checked={theme === id} onClick={() => setTheme(id)} className={cn("inline-flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-[10px] text-[14px] font-semibold", theme === id ? "bg-white shadow-[0_1px_3px_rgba(0,0,0,0.18)] dark:bg-white/20" : "text-muted")}>{Icon && <Icon className="size-4" />}{n}</button>
                ))}
              </div>
              <div role="radiogroup" aria-label="Background" className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
                {MAIL_BACKGROUNDS.map((b) => <button key={b.id} type="button" role="radio" aria-checked={bg === b.id} aria-label={b.name} title={b.name} onClick={() => { setBg(b.id); start(async () => { await setMailLook({ background: b.id }); }); }} className={cn("h-[72px] cursor-pointer rounded-xl transition hover:scale-[1.03]", bg === b.id ? "ring-2 ring-[#4c8dff] ring-offset-2" : "ring-1 ring-inset ring-black/10")} style={{ background: swatchCss(b) }} />)}
                <button type="button" role="radio" aria-checked={bg === RANDOM_BACKGROUND} aria-label="Random" title="Random: a Kigali scene each day" onClick={() => { setBg(RANDOM_BACKGROUND); start(async () => { await setMailLook({ background: RANDOM_BACKGROUND }); }); }} className={cn("flex h-[72px] cursor-pointer items-center justify-center rounded-xl bg-[conic-gradient(from_0deg,#ffd2b8,#bfd2ff,#b8e6c0,#d6c6ff,#ffd2b8)]", bg === RANDOM_BACKGROUND ? "ring-2 ring-[#4c8dff] ring-offset-2" : "ring-1 ring-inset ring-black/10")}><Shuffle className="size-5 text-[#1d1d1f]" /></button>
              </div>
            </>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-black/[0.07] px-7 py-4 dark:border-white/10">
          <button type="button" onClick={finish} className="h-11 cursor-pointer rounded-full px-4 text-[14.5px] font-semibold text-muted hover:bg-black/5 dark:hover:bg-white/10">Skip for now</button>
          <span className="flex-1" />
          {step > 0 && <button type="button" onClick={() => setStep(step - 1)} className="h-11 cursor-pointer rounded-full border border-black/15 px-5 text-[14.5px] font-semibold hover:bg-black/5 dark:border-white/15">Back</button>}
          {step === 0 && <button type="button" onClick={() => setStep(1)} className="h-11 cursor-pointer rounded-full bg-[#1f5ae6] px-7 text-[14.5px] font-semibold text-white hover:bg-[#1a4fd0]">Continue</button>}
          {step === 1 && <button type="submit" form="welcome-sig" disabled={saving} className="h-11 cursor-pointer rounded-full bg-[#1f5ae6] px-7 text-[14.5px] font-semibold text-white hover:bg-[#1a4fd0] disabled:opacity-60">{saving ? "Saving…" : "Continue"}</button>}
          {step === 2 && <button type="button" onClick={finish} className="h-11 cursor-pointer rounded-full bg-[#1f5ae6] px-7 text-[14.5px] font-semibold text-white hover:bg-[#1a4fd0]">Open my mail</button>}
        </footer>
      </section>
    </main>
  );
}
