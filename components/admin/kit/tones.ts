// The admin kit's colours, as full Tailwind class strings (Tailwind only keeps classes it can read in the source, so
// they are never built from pieces). One tone per admin area, used by icon badges, section cards and stat tiles.
//
// Brand colours only (the owner, 10 November 2026): every area tone is a shade of BuPulse's blue-to-violet
// (#2f6bff -> #7b5cff), and the old names (green, orange, pink, teal, indigo) are kept so pages need no change. Colour
// that MEANS something uses "good" (green), "warn" (amber) and "red" (a problem) - never the area tones.

export type KitTone = "blue" | "violet" | "green" | "orange" | "pink" | "red" | "teal" | "indigo" | "slate" | "good" | "warn";

/** The gradient behind a white icon. */
export const TONE_BADGE: Record<KitTone, string> = {
  blue: "bg-[linear-gradient(135deg,#2f6bff,#5b8cff)] shadow-[0_8px_18px_-10px_rgba(47,107,255,0.9)]",
  violet: "bg-[linear-gradient(135deg,#5b4dff,#9b5cff)] shadow-[0_8px_18px_-10px_rgba(123,92,255,0.9)]",
  green: "bg-[linear-gradient(135deg,#2f6bff,#7b5cff)] shadow-[0_8px_18px_-10px_rgba(85,99,255,0.9)]",
  orange: "bg-[linear-gradient(135deg,#4a52f5,#8f6bff)] shadow-[0_8px_18px_-10px_rgba(90,82,245,0.9)]",
  pink: "bg-[linear-gradient(135deg,#7b5cff,#b18cff)] shadow-[0_8px_18px_-10px_rgba(123,92,255,0.9)]",
  red: "bg-[linear-gradient(135deg,#c81e3a,#f43f5e)] shadow-[0_8px_18px_-10px_rgba(200,30,58,0.9)]",
  teal: "bg-[linear-gradient(135deg,#1f7bff,#5fa8ff)] shadow-[0_8px_18px_-10px_rgba(31,123,255,0.9)]",
  indigo: "bg-[linear-gradient(135deg,#3b47d6,#6d7bff)] shadow-[0_8px_18px_-10px_rgba(59,71,214,0.9)]",
  slate: "bg-[linear-gradient(135deg,#475569,#94a3b8)] shadow-[0_8px_18px_-10px_rgba(71,85,105,0.9)]",
  good: "bg-[linear-gradient(135deg,#0f9f6e,#34d399)] shadow-[0_8px_18px_-10px_rgba(15,159,110,0.9)]",
  warn: "bg-[linear-gradient(135deg,#f59e0b,#fbbf24)] shadow-[0_8px_18px_-10px_rgba(245,158,11,0.9)]",
};

/** A soft wash and readable text in the tone (pills, small highlights). */
export const TONE_SOFT: Record<KitTone, string> = {
  blue: "bg-[#2f6bff]/10 text-[#1f55d6] dark:bg-[#2f6bff]/20 dark:text-[#8db0ff]",
  violet: "bg-[#7b5cff]/12 text-[#5b3fd9] dark:bg-[#7b5cff]/22 dark:text-[#b7a6ff]",
  green: "bg-[#5563ff]/10 text-[#3d48d8] dark:bg-[#5563ff]/22 dark:text-[#a9b2ff]",
  orange: "bg-[#5a52f5]/10 text-[#4338ca] dark:bg-[#5a52f5]/22 dark:text-[#b4b0ff]",
  pink: "bg-[#7b5cff]/12 text-[#5b3fd9] dark:bg-[#9b7cff]/22 dark:text-[#c9b8ff]",
  red: "bg-[#c81e3a]/10 text-[#c81e3a] dark:bg-[#ff7a8f]/14 dark:text-[#ff7a8f]",
  teal: "bg-[#1f7bff]/10 text-[#1659c9] dark:bg-[#1f7bff]/20 dark:text-[#93c2ff]",
  indigo: "bg-[#3b47d6]/10 text-[#3b47d6] dark:bg-[#6d7bff]/18 dark:text-[#b0b8ff]",
  slate: "bg-[#475569]/10 text-[#475569] dark:bg-white/10 dark:text-[#cbd5e1]",
  good: "bg-[#0f7a4a]/10 text-[#0f7a4a] dark:bg-[#5fd9a0]/14 dark:text-[#5fd9a0]",
  warn: "bg-[#f59e0b]/12 text-[#b45309] dark:bg-[#fbbf24]/14 dark:text-[#ffc65c]",
};

/** The card surface every kit card shares: white on the grey page, a lifted tone in dark mode. */
export const CARD = "rounded-[22px] border border-line bg-surface shadow-[0_18px_40px_-34px_rgba(17,24,39,0.5)] dark:bg-white/[0.035] dark:shadow-none";

/** Hover lift for cards that are links (off under reduced motion). */
export const LIFT =
  "transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-pulse-blue/35 hover:shadow-[0_22px_44px_-30px_rgba(47,107,255,0.45)] motion-reduce:transform-none motion-reduce:transition-none";

/** The focus ring for kit links and buttons. */
export const FOCUS = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30";
