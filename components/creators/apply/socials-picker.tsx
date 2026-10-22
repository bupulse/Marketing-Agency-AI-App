"use client";

import { useState } from "react";
import { Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { HANDLE_PLACEHOLDER, isTracked, SOCIAL_LABEL, SOCIAL_NETWORKS, type SocialNetwork } from "@/lib/creators/networks";
import type { Values } from "./field-input";

/**
 * "Social media accounts" (docs/CREATOR_CAMPAIGN_WIZARD.md, "Form"): the creator ticks the networks they have, then
 * types the username and followers of each. Every network is listed; the campaign's own are marked, and the ones
 * BuPulse cannot count views on yet say so (they can still be listed, so the company sees the whole audience).
 */
export function SocialsPicker({ values, errors, campaignNetworks }: { values: Values; errors: Partial<Record<string, string>>; campaignNetworks: string[] }) {
  const sent = (n: SocialNetwork) => Boolean((values[`handle_${n}`] as string | undefined)?.trim() || (values[`followers_${n}`] as string | undefined)?.trim());
  const ticked0 = Array.isArray(values.networks) ? values.networks : values.networks ? [values.networks] : [];
  const [ticked, setTicked] = useState<SocialNetwork[]>(SOCIAL_NETWORKS.filter((n) => ticked0.includes(n) || sent(n)));
  const ordered = [...SOCIAL_NETWORKS].sort((a, b) => Number(campaignNetworks.includes(b)) - Number(campaignNetworks.includes(a)));
  const toggle = (n: SocialNetwork) => setTicked((now) => (now.includes(n) ? now.filter((x) => x !== n) : SOCIAL_NETWORKS.filter((x) => now.includes(x) || x === n)));

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-[15px] font-semibold">
        Your social media accounts
        <span aria-hidden className="ml-0.5 text-[color:var(--brand)]">
          *
        </span>
      </legend>
      <p className="-mt-2 text-[13px] text-muted">Tick the ones you have, then type your username and how many followers you have. At least one.</p>
      <div className="flex flex-wrap gap-2">
        {ordered.map((n) => {
          const on = ticked.includes(n);
          return (
            <label key={n} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-glass px-4 py-2 text-[15px] font-medium transition-colors has-checked:border-transparent has-checked:bg-[color:var(--brand)] has-checked:text-[color:var(--on-brand)] has-focus-visible:shadow-ring">
              <input type="checkbox" name="networks" value={n} checked={on} onChange={() => toggle(n)} className="sr-only" />
              {SOCIAL_LABEL[n]}
              {campaignNetworks.includes(n) && <span className={cn("text-[11px] font-semibold uppercase tracking-wide", on ? "opacity-90" : "text-muted")}>· This campaign</span>}
            </label>
          );
        })}
      </div>
      {ticked.map((n) => (
        <div key={n} className="flex flex-col gap-2 rounded-2xl border border-line p-3">
          <p className="flex flex-wrap items-center gap-x-2 text-[14px] font-semibold">
            {SOCIAL_LABEL[n]}
            {!isTracked(n) && <span className="text-[12px] font-medium text-muted">Coming soon: views not counted yet</span>}
          </p>
          <div className="grid grid-cols-[1fr_7.5rem] gap-2">
            <label className="flex flex-col gap-1 text-[13px] font-medium text-muted">
              Username
              <Input name={`handle_${n}`} placeholder={HANDLE_PLACEHOLDER[n]} autoCapitalize="none" autoCorrect="off" defaultValue={(values[`handle_${n}`] as string | undefined) ?? ""} invalid={Boolean(errors[`handle_${n}`])} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium text-muted">
              Followers
              <Input name={`followers_${n}`} inputMode="decimal" placeholder="12k" defaultValue={(values[`followers_${n}`] as string | undefined) ?? ""} invalid={Boolean(errors[`followers_${n}`])} />
            </label>
          </div>
          {(errors[`handle_${n}`] || errors[`followers_${n}`]) && (
            <p role="alert" className="text-[13px] font-medium text-danger">
              {errors[`handle_${n}`] ?? errors[`followers_${n}`]}
            </p>
          )}
        </div>
      ))}
      {errors.handles && (
        <p role="alert" className="text-[13px] font-medium text-danger">
          {errors.handles}
        </p>
      )}
    </fieldset>
  );
}
