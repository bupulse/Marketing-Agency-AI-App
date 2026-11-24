"use client";

import { useActionState, useState, useTransition } from "react";
import { PhoneInput } from "@/components/ui/phone-input";
import { cn } from "@/lib/cn";
import { SIGNATURE_LOOKS, signatureHtmlFor, type SignatureCompany } from "@/lib/mail/signature-render";
import { applyDefaultLookToAll, saveCompany, type ConsoleState } from "@/app/mail/(console)/console/actions";
import { darkBtn, h1, panel, sub } from "./console-styles";
import { Note } from "./console-ui";

// Mail console: Company and look (design ConsoleSignature): liquid glass for the whole team, the company parts of
// every signature, and the default signature look for new users.

type Look = { clarity: number; tint: string; usersChange: boolean; template: string };

const lbl = "flex flex-col gap-1.5 text-[13px] font-semibold";
const inp = "h-[42px] w-full rounded-[11px] border border-[rgba(60,60,67,0.2)] bg-white/90 px-3 text-[14.5px] font-normal outline-none focus:border-[#2f6bff] focus:ring-2 focus:ring-[#2f6bff]/25 dark:border-white/15 dark:bg-white/5";
const TINTS = [["light", "Light", "255,255,255"], ["dark", "Dark", "28,28,32"], ["blue", "Blue tint", "232,238,255"]] as const;
const STAGE = "radial-gradient(160px 160px at 22% 30%, #ff9f6b 0%, rgba(255,159,107,0) 70%), radial-gradient(180px 180px at 78% 40%, #5b8cff 0%, rgba(91,140,255,0) 70%), radial-gradient(200px 160px at 50% 100%, #b28cff 0%, rgba(178,140,255,0) 70%), linear-gradient(135deg, #ffe7d6, #dfe6ff)";

/** The little drawing on each look's button (logo square, accent bar, button shape), from the design. */
const THUMBS: Record<string, [string, string, string]> = {
  classic: ["size-3.5 rounded-[4px] bg-[linear-gradient(135deg,#2f6bff,#7b5cff)]", "h-7 w-0.5 bg-[#2f6bff]", "h-1.5 w-[44%] rounded-[3px] bg-[#1f5ae6]"],
  compact: ["size-3 rounded-[3px] bg-[linear-gradient(135deg,#2f6bff,#7b5cff)]", "hidden", "hidden"],
  card: ["hidden", "hidden", "h-1.5 w-[40%] rounded-full border border-[#1f5ae6]"],
  simple: ["hidden", "hidden", "hidden"],
  banner: ["hidden", "hidden", "h-2 w-full rounded-[3px] bg-[linear-gradient(90deg,#2f6bff,#6a4df0)]"],
};

const SAMPLE = { name: "{name}", title: "{title}", email: "{email}", mobile: "{their phone}", extra: null };

export function CompanyView({ company, look, users }: { company: SignatureCompany & { companyPhoneE164: string }; look: Look; users: number }) {
  const [state, action, pending] = useActionState<ConsoleState, FormData>(saveCompany, {});
  const [clarity, setClarity] = useState(look.clarity);
  const [tint, setTint] = useState(look.tint);
  const [template, setTemplate] = useState(look.template);
  const [f, setF] = useState({ website: company.website, address: company.address, linkedinUrl: company.linkedinUrl ?? "", instagramUrl: company.instagramUrl ?? "", facebookUrl: company.facebookUrl ?? "", ctaText: company.ctaText, ctaUrl: company.ctaUrl });
  const [applyNote, setApplyNote] = useState<ConsoleState>({});
  const [applying, startApply] = useTransition();
  const field = (k: keyof typeof f) => ({ name: k, value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [k]: e.target.value })) });

  const rgb = TINTS.find((t) => t[0] === tint)?.[2] ?? TINTS[0][2];
  const pane: React.CSSProperties = {
    background: `rgba(${rgb},${(0.18 + clarity * 0.0075).toFixed(2)})`,
    backdropFilter: `blur(${Math.round(2 + clarity * 0.34)}px) saturate(1.8)`,
    WebkitBackdropFilter: `blur(${Math.round(2 + clarity * 0.34)}px) saturate(1.8)`,
    color: tint === "dark" ? "#ffffff" : "#1d1d1f",
  };
  const preview = signatureHtmlFor(template, { ...company, ...f, linkedinUrl: f.linkedinUrl || null, instagramUrl: f.instagramUrl || null, facebookUrl: f.facebookUrl || null }, SAMPLE);

  return (
    <form id="company-form" action={action} className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex-[1_1_320px]"><h1 className={h1}>Company and look</h1><p className={sub}>What every signature shows, and how Mail looks for the whole team.</p></div>
        <button disabled={pending} className={darkBtn}>{pending ? "Saving…" : "Save"}</button>
      </header>
      <Note s={state} />

      <div className="flex flex-wrap items-start gap-4">
        <section aria-label="Liquid glass" className={cn(panel, "flex min-w-0 flex-[1_1_420px] flex-col gap-3.5 p-[22px]")}>
          <div className="flex items-baseline justify-between"><h2 className="m-0 text-[18px] font-semibold">Liquid glass</h2><span className="text-[13px] font-semibold text-[#1f5ae6] dark:text-[#9dbbff]">{clarity < 30 ? "Clear" : clarity < 70 ? "Balanced" : "Frosted"}</span></div>
          <div aria-hidden className="relative flex h-[190px] items-center justify-center overflow-hidden rounded-[18px]" style={{ background: STAGE }}>
            <div className="flex w-[76%] flex-col gap-3 rounded-[20px] border border-white/55 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_18px_40px_-20px_rgba(15,23,42,0.45)] transition-all duration-200" style={pane}>
              {[["#11633a", "Y", "Your bank", "Monthly statement"], ["#1946b8", "A", "A customer", "Quote for a social media package"]].map(([bg, i, t, s]) => (
                <span key={t} className="flex items-center gap-2.5"><span className="inline-flex size-[34px] items-center justify-center rounded-full text-[13px] font-semibold text-white" style={{ background: bg }}>{i}</span><span className="flex flex-col"><span className="text-[14px] font-bold">{t}</span><span className="text-[12.5px]">{s}</span></span></span>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">How clear the glass is
            <input type="range" name="glassClarity" min={0} max={100} step={5} value={clarity} onChange={(e) => setClarity(Number(e.target.value))} className="accent-[#1f5ae6]" />
            <span className="flex justify-between text-[12px] font-medium text-muted"><span>Clear</span><span>Frosted</span></span>
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold">Tint</span>
            <input type="hidden" name="glassTint" value={tint} />
            <div role="radiogroup" aria-label="Tint" className="flex gap-1 rounded-[13px] bg-[rgba(60,60,67,0.08)] p-1 dark:bg-white/10">
              {TINTS.map(([id, name]) => (
                <button key={id} type="button" role="radio" aria-checked={tint === id} onClick={() => setTint(id)} className={cn("inline-flex h-9 flex-1 cursor-pointer items-center justify-center rounded-[10px] text-[13.5px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2f6bff]", tint === id ? "bg-white shadow-[0_2px_8px_-3px_rgba(0,0,0,0.25)] dark:bg-white/20" : "text-[#3c3c43] dark:text-white/70")}>{name}</button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2.5 text-[14px] font-medium"><input type="checkbox" name="usersChangeGlass" defaultChecked={look.usersChange} className="size-[18px] accent-[#1f5ae6]" />Each person may change it in their own Settings</label>
          <p className="m-0 text-[12.5px] text-muted">Text always stays readable: the glass never gets clearer than the contrast rules allow.</p>
        </section>

        <section aria-label="Company details" className={cn(panel, "flex min-w-0 flex-[999_1_460px] flex-col gap-3.5 p-[22px]")}>
          <h2 className="m-0 text-[18px] font-semibold">Company details in every signature</h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
            <label className={lbl}>Website<input {...field("website")} className={inp} /></label>
            <div className={cn(lbl, "col-span-full")}>
              <span>Company phone (in every signature, staff cannot change it)</span>
              <PhoneInput name="companyPhone" defaultValue={company.companyPhoneE164} placeholder="720 123 456" countryLabel="Country" />
              <span className="text-[12.5px] font-normal text-muted">Each person can add their own mobile number in Settings; it shows next to this one.</span>
            </div>
            <label className={cn(lbl, "col-span-full")}>Address<input {...field("address")} className={inp} /></label>
            <label className={lbl}>LinkedIn page<input {...field("linkedinUrl")} placeholder="linkedin.com/company/bupulse" className={inp} /></label>
            <label className={lbl}>Instagram<input {...field("instagramUrl")} placeholder="instagram.com/bupulse" className={inp} /></label>
            <label className={lbl}>Facebook page<input {...field("facebookUrl")} placeholder="facebook.com/bupulse" className={inp} /></label>
            <label className={lbl}>Button text<input {...field("ctaText")} className={inp} /></label>
            <label className={cn(lbl, "col-span-full")}>Button link<input {...field("ctaUrl")} className={inp} /></label>
          </div>

          <span className="mt-1 text-[13px] font-semibold">Default look for new users</span>
          <input type="hidden" name="defaultTemplate" value={template} />
          <div role="radiogroup" aria-label="Default signature look" className="grid grid-cols-5 gap-2 max-sm:grid-cols-3">
            {SIGNATURE_LOOKS.map((l) => (
              <button key={l.id} type="button" role="radio" aria-checked={template === l.id} onClick={() => setTemplate(l.id)} className={cn("flex cursor-pointer flex-col gap-2 rounded-[14px] bg-white p-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2f6bff] dark:bg-white/10", template === l.id ? "shadow-[0_0_0_2px_#1f5ae6]" : "shadow-[inset_0_0_0_1px_rgba(60,60,67,0.16)]")}>
                <span aria-hidden className="flex h-[46px] items-center gap-[5px] rounded-lg bg-[#f5f6fa] p-[7px]">
                  <span className={THUMBS[l.id][0]} /><span className={THUMBS[l.id][1]} />
                  <span className="flex flex-1 flex-col gap-1"><span className="h-1 w-[70%] rounded-sm bg-[#0f172a]" /><span className="h-[3px] w-1/2 rounded-sm bg-[#1f5ae6]" /><span className={THUMBS[l.id][2]} /></span>
                </span>
                <span className="text-[12px] font-semibold">{l.name}</span>
              </button>
            ))}
          </div>
          <div aria-label="Preview" className="overflow-x-auto rounded-2xl border border-[rgba(60,60,67,0.1)] bg-white p-[18px] text-[#0f172a]" dangerouslySetInnerHTML={{ __html: preview }} />
          <span className="text-[12.5px] text-muted">Company details reach every signature as soon as you save. The look you pick here is given to each new user; they can change it in Settings.</span>
          <div className="flex flex-wrap items-center gap-2.5">
            <button type="button" disabled={applying || template !== look.template || users === 0} onClick={() => startApply(async () => setApplyNote(await applyDefaultLookToAll()))} className="inline-flex h-[42px] cursor-pointer items-center rounded-full border border-[rgba(60,60,67,0.22)] px-[18px] text-[14px] font-semibold disabled:cursor-default disabled:opacity-50 dark:border-white/20">Use this look for all {users === 1 ? "1 user" : `${users} users`}</button>
            {template !== look.template && <span className="text-[12.5px] text-muted">Save first to give it to everyone.</span>}
          </div>
          <Note s={applyNote} />
        </section>
      </div>
    </form>
  );
}
