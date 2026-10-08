"use client";

import { Atom, FileCode2, Layers, LayoutTemplate, Newspaper, ShoppingBag, Square, Tags, TriangleAlert, Workflow, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { CopyButton } from "@/components/studio/copy-button";
import { Chip, Dialog, GlassCard } from "@/components/ui";
import { buildPlatforms, PASTE_WARNING, type PlatformId } from "@/lib/widget/install";
import { InstallCheck } from "./install-check";
import { Walkthrough } from "./walkthrough";

// Generic icons on purpose: no company logos.
const ICONS: Record<PlatformId, LucideIcon> = {
  html: FileCode2,
  wordpress: Newspaper,
  nextjs: Layers,
  react: Atom,
  shopify: ShoppingBag,
  wix: LayoutTemplate,
  squarespace: Square,
  webflow: Workflow,
  gtm: Tags,
};

export function InstallGuide({ baseUrl, widgetKey, accent }: { baseUrl: string; widgetKey: string; accent: string }) {
  const platforms = useMemo(() => buildPlatforms({ baseUrl, key: widgetKey }), [baseUrl, widgetKey]);
  const [openId, setOpenId] = useState<PlatformId | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const platform = platforms.find((p) => p.id === openId) ?? null;
  const variant = platform ? (platform.variants.find((v) => v.id === variantId) ?? platform.variants[0]) : null;

  return (
    <GlassCard as="section" aria-labelledby="w-install" className="flex flex-col gap-5 p-5 sm:p-6">
      <div>
        <h2 id="w-install" className="text-lg font-semibold tracking-[-0.02em]">Add it to your website</h2>
        <p className="text-[14px] text-muted">Choose where your website is built. You get the exact code and an animated, step-by-step guide.</p>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {platforms.map((p) => {
          const Icon = ICONS[p.id];
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => {
                  setOpenId(p.id);
                  setVariantId(null);
                }}
                className="glass flex min-h-[88px] w-full cursor-pointer flex-col items-start gap-2 rounded-2xl p-4 text-left transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <span className="flex size-9 items-center justify-center rounded-xl bg-soft text-pulse-blue">
                  <Icon aria-hidden className="size-5" />
                </span>
                <span className="flex flex-col">
                  <span className="text-[15px] font-semibold">{p.name}</span>
                  <span className="text-[12.5px] text-muted">{p.tagline}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <InstallCheck />

      <Dialog
        open={platform !== null}
        onOpenChange={(o) => !o && setOpenId(null)}
        title={platform ? `Add the chat to ${platform.name}` : "Install"}
        description={platform?.tagline}
        className="max-w-3xl"
      >
        {platform && variant && (
          <div className="flex flex-col gap-6 pt-1">
            {platform.variants.length > 1 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Option">
                {platform.variants.map((v) => (
                  <Chip key={v.id} selected={v.id === variant.id} onClick={() => setVariantId(v.id)}>
                    {v.label}
                  </Chip>
                ))}
              </div>
            )}

            <section aria-label="Code to copy" className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[15px] font-semibold">1. Copy this code</h3>
                <CopyButton text={variant.code} label="Copy code" />
              </div>
              <pre className="max-h-80 overflow-auto rounded-2xl bg-[#12131a] p-4 text-[12.5px] leading-relaxed whitespace-pre-wrap text-[#d8dbe6] [overflow-wrap:anywhere]" tabIndex={0}>
                <code>{variant.code}</code>
              </pre>
              <p className="flex items-start gap-2 rounded-2xl bg-danger-bg p-3 text-[13px] text-danger">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                {PASTE_WARNING}
              </p>
              {variant.note && <p className="text-[13px] text-muted">{variant.note}</p>}
            </section>

            <section aria-label="How to add it" className="flex flex-col gap-3">
              <h3 className="text-[15px] font-semibold">2. Follow along</h3>
              <Walkthrough key={`${platform.id}-${variant.id}`} steps={variant.steps} accent={accent} />
            </section>
          </div>
        )}
      </Dialog>
    </GlassCard>
  );
}
