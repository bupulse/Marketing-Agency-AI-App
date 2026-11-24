import { cn } from "@/lib/cn";

// The B Mail / B Drive / B CRM lockup (owner, 23 Nov 2026): the BuPulse "B" with its pulse line running all the time
// (calm loop, stopped for "reduce motion"), then the word, no dot. Traced from public/brand/mark.png (500 x 500: the
// blue-to-violet pulse line running into the black B) so the pulse can move along the real mark.

const PULSE = "M28 268H176L205.5 150L266 343L301.5 248H345";
const B = "M246 122H387A63 63 0 0 1 387 248M330 248H389A63 63 0 0 1 389 374H296";

export function BMark({ size = 32, className, tone = "ink" }: { size?: number; className?: string; tone?: "ink" | "white" }) {
  const id = `bp-${size}-${tone}`;
  return (
    <svg width={size} height={size} viewBox="20 100 470 300" aria-hidden className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="190" y1="200" x2="290" y2="330">
          <stop offset="0" stopColor="#0854fd" />
          <stop offset="1" stopColor="#7654fc" />
        </linearGradient>
      </defs>
      <path d={B} fill="none" stroke={tone === "white" ? "#fff" : "currentColor"} strokeWidth="27" strokeLinejoin="round" />
      <path d={PULSE} fill="none" stroke={`url(#${id})`} strokeWidth="25" strokeLinejoin="miter" strokeMiterlimit="3.3" opacity="0.28" />
      <path className="bmail-pulse" d={PULSE} fill="none" stroke={`url(#${id})`} strokeWidth="25" strokeLinejoin="miter" strokeMiterlimit="3.3" strokeDasharray="420 300" />
    </svg>
  );
}

export function BLockup({ word = "Mail", size = 32, className }: { word?: string; size?: number; className?: string }) {
  return (
    <span role="img" aria-label={`B ${word}`} className={cn("inline-flex items-center gap-1.5 text-text", className)}>
      <BMark size={size} />
      <span className="font-extrabold tracking-[-0.02em]" style={{ fontSize: Math.round(size * 0.66) }}>
        {word}
      </span>
    </span>
  );
}
