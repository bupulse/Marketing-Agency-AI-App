"use client";

import { useActionState, useState } from "react";
import { PhoneInput } from "@/components/ui/phone-input";
import { cn } from "@/lib/cn";
import { saveProfile, type ProfileState } from "@/app/mail/(app)/actions";

const BGS = [
  ["kigali-hills", "Kigali hills", "bg-[url(/mail/backgrounds/kigali-hills.svg)] bg-cover bg-bottom"],
  ["kigali-night", "Kigali at night", "bg-[url(/mail/backgrounds/kigali-night.svg)] bg-cover bg-bottom"],
  ["kivu-beach", "Lake Kivu beach", "bg-[url(/mail/backgrounds/kivu-beach.svg)] bg-cover bg-bottom"],
  ["virunga", "Virunga volcanoes", "bg-[url(/mail/backgrounds/virunga.svg)] bg-cover bg-bottom"],
  ["plain", "Plain", "bg-[#f3f4f7]"],
] as const;

export function SettingsForm({ profile, signatureHtml, companyPhone }: { profile: { name: string; title: string; phone: string; extra: string; background: string; email: string }; signatureHtml: string; companyPhone: string }) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(saveProfile, {});
  const [bg, setBg] = useState(profile.background || "kigali-hills");
  const card = "rounded-[24px] border border-white/80 bg-white/[0.86] p-6 shadow-[0_20px_50px_-30px_rgba(15,23,42,0.4)] backdrop-blur-2xl dark:border-white/10 dark:bg-[rgba(28,28,34,0.86)]";
  const input = "h-12 w-full rounded-2xl border border-black/15 bg-white px-4 text-[16px] outline-none focus:border-[#2f6bff] focus:ring-2 focus:ring-[#2f6bff]/25 dark:border-white/15 dark:bg-white/5";
  const label = "flex flex-col gap-2 text-[13.5px] font-semibold";
  return (
    <form action={action} className="flex flex-col gap-4">
      <h1 className="px-1 text-[28px] font-bold tracking-[-0.025em]">Profile and signature</h1>
      <section className={card} aria-labelledby="me">
        <h2 id="me" className="mb-4 text-[18px] font-semibold">You</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className={label}>Name<input name="name" defaultValue={profile.name} required className={input} /></label>
          <label className={label}>Job title<input name="title" defaultValue={profile.title} placeholder="Founder" className={input} /></label>
          <div className={`${label} md:col-span-2`}><span>Personal phone (optional)</span><PhoneInput name="phone" defaultValue={profile.phone} placeholder="720 123 456" countryLabel="Country" /><span className="text-[12.5px] font-normal text-muted">Shown as "Mobile" in your signature, next to the company number.</span></div>
          <label className={`${label} md:col-span-2`}>Extra line (optional)<input name="signatureExtra" defaultValue={profile.extra} placeholder="Available Monday to Saturday, 8:00 to 18:00" className={input} /></label>
        </div>
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-black/[0.04] px-4 py-3 text-[14px] dark:bg-white/[0.06]">
          <span className="flex-1"><span className="block text-[12.5px] text-muted">Company phone, in every signature (set by your admin)</span><strong className="text-[16px]">{companyPhone || "Not set yet"}</strong></span>
        </div>
      </section>
      <section className={card} aria-labelledby="sig">
        <h2 id="sig" className="mb-1 text-[18px] font-semibold">Your signature</h2>
        <p className="mb-4 text-[13.5px] text-muted">Logo, website, address, social links and the quote button come from the Mail console. Save to see your changes here.</p>
        <div className="rounded-2xl bg-white p-5 text-[#0f172a]" dangerouslySetInnerHTML={{ __html: signatureHtml }} />
      </section>
      <section id="look" className={card} aria-labelledby="lookh">
        <h2 id="lookh" className="mb-1 text-[18px] font-semibold">Background</h2>
        <p className="mb-4 text-[13.5px] text-muted">Light or dark: the moon or sun button at the top. Only you see your background.</p>
        <input type="hidden" name="background" value={bg} />
        <div role="radiogroup" aria-label="Background" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {BGS.map(([id, name, cls]) => (
            <button key={id} type="button" role="radio" aria-checked={bg === id} onClick={() => setBg(id)} className={cn("flex h-24 cursor-pointer items-end rounded-2xl p-2 transition hover:-translate-y-0.5", cls, bg === id ? "ring-2 ring-[#1f5ae6] ring-offset-2" : "ring-1 ring-black/10")}>
              <span className="rounded-lg bg-white/85 px-2 py-0.5 text-[12px] font-semibold text-[#1d1d1f]">{name}</span>
            </button>
          ))}
        </div>
      </section>
      <div className="flex items-center gap-3 px-1">
        <button disabled={pending} className="h-12 cursor-pointer rounded-full bg-[#1f5ae6] px-7 text-[15px] font-semibold text-white hover:bg-[#1a4fd0] disabled:opacity-60">{pending ? "Saving…" : "Save"}</button>
        {state.ok && <span role="status" className="text-[14px] font-medium text-[#11633a]">{state.ok}</span>}
        {state.error && <span role="alert" className="text-[14px] font-medium text-[#b42318]">{state.error}</span>}
      </div>
    </form>
  );
}
