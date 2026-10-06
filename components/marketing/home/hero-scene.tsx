import { Check } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Mark } from "@/components/brand";
import { Float, PulseLine } from "@/components/motion";
import { cn } from "@/lib/cn";
import "./home.css";

/** Positioned, depth-offset slot. Floats inside so the bob never fights the 3D transform. */
function Slot({
  className,
  z,
  delay,
  children,
}: {
  className: string;
  z: number;
  delay?: number;
  children: ReactNode;
}) {
  return (
    <div className={cn("absolute", className)} style={{ transform: `translateZ(${z}px)` } as CSSProperties}>
      <Float delay={delay}>{children}</Float>
    </div>
  );
}

function PostPhoto({ label, title, from, to, height }: { label: string; title: string; from: string; to: string; height: number }) {
  return (
    <div
      className="relative flex items-end overflow-hidden rounded-[20px] p-3.5 text-white"
      style={{ height, background: `linear-gradient(150deg, ${from}, ${to})` }}
    >
      <div className="relative flex flex-col gap-0.5">
        <span className="text-[10px] font-semibold tracking-[0.12em]">{label}</span>
        <strong className="text-[15px]">{title}</strong>
      </div>
    </div>
  );
}

/** Decorative 3D scene: CSS only, no JS. Side cards are hidden on phones to keep it light. */
export function HeroScene() {
  return (
    <div aria-hidden className="hs-stage relative h-[430px] min-w-0 md:h-[580px]">
      <PulseLine className="absolute top-[44%] -left-6 h-40 w-[calc(100%+48px)] overflow-visible" />
      <div className="hs-scene">
        <Slot z={40} className="top-6 left-1/2 w-[240px] -translate-x-1/2 md:top-24 md:w-[260px]">
          <div className="glass-strong rounded-[34px] p-3">
            <div className="flex items-center gap-2.5 px-1.5 pt-1 pb-2.5">
              <Mark variant="icon" size={30} alt="" className="rounded-[9px]" />
              <div className="flex flex-col">
                <strong className="text-[13px]">[your.shop]</strong>
                <span className="text-[11px] text-muted">Phone &amp; electronics store</span>
              </div>
            </div>
            <div
              className="relative flex h-[180px] items-end overflow-hidden rounded-[20px] p-3.5 text-white md:h-[210px]"
              style={{ background: "linear-gradient(160deg, #2F6BFF 0%, #7B5CFF 100%)" }}
            >
              <div className="absolute inset-x-0 top-4 text-center text-[13px] text-white/75">[Product photo]</div>
              <div className="relative flex flex-col gap-1">
                <span className="text-[11px] font-semibold tracking-[0.12em]">NEW ARRIVALS</span>
                <strong className="text-[22px] tracking-[-0.02em]">[Phone model] in stock</strong>
                <span className="text-[13px]">This weekend only: [offer]</span>
              </div>
            </div>
            <p className="m-0 px-1.5 pt-2.5 pb-1 text-[13px] leading-snug">
              Fresh stock just landed. Come try it in store, or message us to reserve yours.{" "}
              <span className="text-[color:var(--bp-link)]">#NewArrivals #TechDeals</span>
            </p>
          </div>
        </Slot>

        <Slot z={120} delay={2} className="top-2.5 -left-2.5 hidden w-[200px] md:block">
          <div className="glass-strong rounded-[22px] p-2.5">
            <PostPhoto label="SCHOOL" title="Enrollment is open" from="#0B0B0F" to="#2F6BFF" height={92} />
            <p className="m-0 px-1 pt-2 pb-0.5 text-xs text-muted">Caption + parent FAQ ready</p>
          </div>
        </Slot>

        <Slot z={150} delay={4} className="top-[70px] -right-2.5 hidden w-[210px] md:block">
          <div className="glass-strong rounded-[22px] p-2.5">
            <PostPhoto label="CONSTRUCTION" title="Project complete" from="#7B5CFF" to="#0B0B0F" height={92} />
            <p className="m-0 px-1 pt-2 pb-0.5 text-xs text-muted">Before/after reel script ready</p>
          </div>
        </Slot>

        <Slot z={170} delay={2} className="right-0 bottom-[60px] hidden w-[236px] md:block">
          <div className="glass-strong flex flex-col gap-2 rounded-[22px] px-4 py-3.5">
            <span className="flex items-center gap-2 text-xs text-muted">
              <span className="size-2 shrink-0 animate-ping-soft rounded-full bg-pulse-blue" />
              New lead from your website
            </span>
            <strong className="text-[15px]">[Visitor name]</strong>
            <span className="text-[13px] text-muted">Asked for a quote</span>
          </div>
        </Slot>

        <Slot z={100} className="bottom-3 left-2.5 w-[220px] md:bottom-10">
          <div className="glass-strong flex items-center gap-3 rounded-[22px] px-4 py-3.5">
            <span className="flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-soft text-pulse-blue">
              <Check className="size-[18px]" />
            </span>
            <div className="flex flex-col gap-0.5">
              <strong className="text-sm">In your brand voice</strong>
              <span className="text-xs text-muted">Every post, every time</span>
            </div>
          </div>
        </Slot>
      </div>
    </div>
  );
}
