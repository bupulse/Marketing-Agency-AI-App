import { cn } from "@/lib/cn";

// The B Mail / B Drive / B CRM lockup (owner, 23 Nov 2026): the BuPulse "B" with its pulse line running all the time
// (calm loop, stopped for "reduce motion"), then the word, no dot. The B is drawn as an SVG so the pulse can move.
// TODO: replace these paths with a trace of public/brand/mark.png before launch to match the real mark exactly.

export function BMark({ size = 32, className, tone = "ink" }: { size?: number; className?: string; tone?: "ink" | "white" }) {
  const id = `bp-${size}-${tone}`;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id={id} x1="0" x2="1">
          <stop offset="0" stopColor="#1f5bff" />
          <stop offset="1" stopColor="#7b5cff" />
        </linearGradient>
      </defs>
      <path d="M60 26h22a18 18 0 010 36H66M66 62h20a19 19 0 010 38H62" fill="none" stroke={tone === "white" ? "#fff" : "currentColor"} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 64H30L40 36L52 92L62 62H70" fill="none" stroke={`url(#${id})`} strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" opacity="0.16" />
      <path className="bmail-pulse" d="M6 64H30L40 36L52 92L62 62H70" fill="none" stroke={`url(#${id})`} strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="90 60" />
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
