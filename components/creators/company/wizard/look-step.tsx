"use client";

// Step 11 of the campaign wizard: how the application page looks (docs/CREATOR_CAMPAIGN_WIZARD.md, "Branding"). The
// brand's logo and colour always; a cover photo or video from Photos if the owner picks one; whether it shows on the
// marketplace and takes applications. The real page (/c/<slug>) is drawn by the creator side.

import { ImagePlus, Play, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui";
import { MediaPicker } from "@/components/media/media-picker";
import { payRulesInWords } from "@/lib/creators/company-forms";
import { Question, Switch } from "./controls";
import type { StepProps } from "./wizard";

export type BrandLook = { name: string; logoUrl: string | null; accent: string; colors: string[] };

export function LookStep({ a, set, o }: StepProps) {
  const [picking, setPicking] = useState(false);
  const [cover, setCover] = useState(o.cover);
  const words = payRulesInWords(a.payRules, a.currency);
  return (
    <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="flex min-w-0 flex-col gap-7">
        <Question label="Your brand" hint="Your logo and colour come from Brand." id="q-brand">
          <div className="flex flex-wrap items-center gap-3">
            {o.brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- private signed URL
              <img src={o.brand.logoUrl} alt="Your logo" className="size-14 rounded-2xl border border-line bg-white object-contain p-1" />
            ) : (
              <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-soft text-[13px] text-muted">No logo</span>
            )}
            <span className="flex gap-1.5" aria-label="Brand colours">
              {(o.brand.colors.length ? o.brand.colors : [o.brand.accent]).slice(0, 5).map((c) => (
                <span key={c} title={c} className="size-8 rounded-full border border-line" style={{ background: c }} />
              ))}
            </span>
            <Link href="/dashboard/brand" className="text-[14px] font-medium underline">
              {o.brand.logoUrl ? "Change in Brand" : "Add your logo in Brand"}
            </Link>
          </div>
        </Question>

        <Question label="Cover photo or video" hint="At the top of your application page. Optional, but pages with a cover get more applications." id="q-cover">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" leading={<ImagePlus aria-hidden className="size-4" />} onClick={() => setPicking(true)}>
              {cover ? "Pick another" : "Pick from Photos"}
            </Button>
            {cover && (
              <Button
                variant="outline"
                leading={<Trash2 aria-hidden className="size-4" />}
                onClick={() => {
                  setCover(null);
                  set({ look: { ...a.look, coverAssetId: null } });
                }}
              >
                Remove
              </Button>
            )}
          </div>
        </Question>

        <Question label="Who can find it" id="q-listed">
          <div className="flex flex-col gap-2.5">
            <Switch checked={a.listed} onChange={(listed) => set({ listed })} label="Show on the marketplace" hint="Creators find it on bupulse.com/creators while it is live. Off: only people with your link can apply." />
            <Switch checked={a.acceptingApplications} onChange={(acceptingApplications) => set({ acceptingApplications })} label="Take applications" hint="Off: the page shows the campaign but nobody can apply." />
          </div>
        </Question>
      </div>

      <figure aria-label="Preview of your application page" className="mx-auto w-full max-w-[320px]">
        <div className="overflow-hidden rounded-[1.6rem] border border-line bg-white text-neutral-900 shadow-glass">
          <div className="relative aspect-[16/10] bg-neutral-700" style={cover && (cover.kind !== "video" || cover.posterUrl) ? undefined : { background: `linear-gradient(135deg, ${o.brand.accent}, ${o.brand.colors[1] ?? o.brand.accent}cc)` }}>
            {cover && (cover.kind !== "video" || cover.posterUrl) && (
              // eslint-disable-next-line @next/next/no-img-element -- private signed URL
              <img src={cover.kind === "video" ? cover.posterUrl! : cover.url} alt="" className="size-full object-cover" />
            )}
            {cover?.kind === "video" && (
              <span aria-hidden className="absolute inset-0 flex items-center justify-center">
                <span className="inline-flex size-11 items-center justify-center rounded-full bg-black/55 text-white">
                  <Play className="size-5 translate-x-px" />
                </span>
              </span>
            )}
          </div>
          <div className="-mt-7 flex flex-col items-center gap-2 px-5 pb-5 text-center">
            {o.brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- private signed URL
              <img src={o.brand.logoUrl} alt="" className="relative size-14 rounded-full border-4 border-white bg-white object-contain" />
            ) : (
              <span className="relative inline-flex size-14 items-center justify-center rounded-full border-4 border-white text-[20px] font-bold text-white" style={{ background: o.brand.accent }}>
                {o.brand.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <p className="text-[12px] font-medium text-neutral-500">{o.brand.name}</p>
            <p className="text-[18px] leading-tight font-semibold">{a.name || "Your campaign"}</p>
            {words[0] && (
              <p className="rounded-full px-3 py-1 text-[12px] font-semibold text-white" style={{ background: o.brand.accent }}>
                {words[0]}
              </p>
            )}
            <p className="line-clamp-4 text-[13px] text-neutral-600">{a.brief || "Your brief shows here."}</p>
            <span className="mt-2 flex min-h-11 w-full items-center justify-center rounded-full text-[14px] font-semibold text-white" style={{ background: o.brand.accent }}>
              {a.acceptingApplications ? "Apply now" : "Not taking applications"}
            </span>
            <p className="text-[10px] text-neutral-400">Powered by BuPulse</p>
          </div>
        </div>
        <figcaption className="mt-2 text-center text-[12px] text-muted">{o.slug ? `bupulse.com/c/${o.slug}` : "Your application page"}</figcaption>
      </figure>

      <MediaPicker
        open={picking}
        onOpenChange={setPicking}
        videos
        title="Choose a cover"
        onPick={([p]) => {
          if (!p) return;
          const video = p.mimeType.startsWith("video/");
          setCover({ url: p.url, kind: video ? "video" : "photo", posterUrl: null });
          set({ look: { ...a.look, coverAssetId: p.id } });
        }}
      />
    </div>
  );
}
