"use client";

import { useEffect, useState } from "react";
import { drawFrame, loadVideoFonts } from "@/components/visuals/video-renderer";
import type { PackId } from "@/lib/designs/packs";
import { buildVideoPlan } from "@/lib/visuals/video-plan";
import { getVideoLook } from "@/lib/visuals/video-looks";

const SCRIPT = "Fresh sourdough every morning\nBaked slowly with local flour\nRWF 4,500 a loaf this week\nOrder on WhatsApp before 8 pm";

/** A stand-in photo for previews: a soft gradient drawn on a canvas (no image asset ships). */
function samplePhoto(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 1200;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 900, 1200);
  g.addColorStop(0, "#1d3557");
  g.addColorStop(0.6, "#e63946");
  g.addColorStop(1, "#f1faee");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 900, 1200);
  const sun = ctx.createRadialGradient(300, 420, 10, 300, 420, 360);
  sun.addColorStop(0, "#f4d35e");
  sun.addColorStop(1, "rgba(244,211,94,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, 900, 1200);
  return canvas;
}

/** One frame per look (opening scene and a middle scene), drawn with the real renderer, as small images. */
export function LookPreviews({ style, ids }: { style: PackId; ids: string[] }) {
  const [frames, setFrames] = useState<Record<string, string[]>>({});
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadVideoFonts(style);
      const photo = samplePhoto();
      const big = document.createElement("canvas");
      big.width = 1080;
      big.height = 1920;
      const small = document.createElement("canvas");
      small.width = 216;
      small.height = 384;
      const ctx = big.getContext("2d")!;
      const out: Record<string, string[]> = {};
      for (const id of ids) {
        const look = getVideoLook(id);
        const plan = buildVideoPlan({ script: SCRIPT, hook: "Fresh sourdough every morning", cta: "Order on WhatsApp", businessName: "Sunrise Bakery", photos: look?.needsPhoto ? ["p"] : ["p", "p"], pack: style, colors: ["#E4572E", "#F3A712"], look: id, contact: "+250 788 000 000" });
        const images = new Map([["p", photo]]);
        out[id] = [0.4, 0.55, 0.97].map((f) => {
          const at = plan.totalMs * f;
          drawFrame(ctx, plan, images, at);
          small.getContext("2d")!.drawImage(big, 0, 0, 216, 384);
          return small.toDataURL("image/jpeg", 0.8);
        });
        if (cancelled) return;
      }
      setFrames(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [style, ids]);

  return (
    <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
      {ids.map((id) => {
        const look = getVideoLook(id);
        return (
          <li key={id} className="flex flex-col gap-1.5">
            <div className="flex gap-1">
              {(frames[id] ?? [null, null, null]).map((src, i) =>
                src ? (
                  // eslint-disable-next-line @next/next/no-img-element -- frames drawn in the browser
                  <img key={i} src={src} alt={`${id} frame ${i + 1}`} width={72} height={128} className="h-auto w-1/3 rounded border border-line" />
                ) : (
                  <div key={i} className="aspect-[9/16] w-1/3 animate-pulse rounded border border-line bg-soft" />
                ),
              )}
            </div>
            <p className="font-mono text-xs font-semibold">{id}</p>
            {look && (
              <p className="text-xs text-muted">
                {look.name} · {look.transition.kind} · {look.caption.box} captions · fits {look.fits.slice(0, 3).join(", ")}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
