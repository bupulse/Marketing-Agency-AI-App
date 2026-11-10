// The admin kit's colours, as full Tailwind class strings (Tailwind only keeps classes it can read in the source, so
// they are never built from pieces). One tone per admin area, used by icon badges, section cards and stat tiles.

export type KitTone = "blue" | "violet" | "green" | "orange" | "pink" | "red" | "teal" | "indigo" | "slate";

/** The gradient behind a white icon. */
export const TONE_BADGE: Record<KitTone, string> = {
  blue: "bg-[linear-gradient(135deg,#2f6bff,#5b8cff)] shadow-[0_8px_18px_-10px_rgba(47,107,255,0.9)]",
  violet: "bg-[linear-gradient(135deg,#5b4dff,#9b5cff)] shadow-[0_8px_18px_-10px_rgba(123,92,255,0.9)]",
  green: "bg-[linear-gradient(135deg,#0f9f6e,#34d399)] shadow-[0_8px_18px_-10px_rgba(15,159,110,0.9)]",
  orange: "bg-[linear-gradient(135deg,#f97316,#fbbf24)] shadow-[0_8px_18px_-10px_rgba(249,115,22,0.9)]",
  pink: "bg-[linear-gradient(135deg,#db2777,#f472b6)] shadow-[0_8px_18px_-10px_rgba(219,39,119,0.9)]",
  red: "bg-[linear-gradient(135deg,#c81e3a,#f43f5e)] shadow-[0_8px_18px_-10px_rgba(200,30,58,0.9)]",
  teal: "bg-[linear-gradient(135deg,#0e7490,#22d3ee)] shadow-[0_8px_18px_-10px_rgba(14,116,144,0.9)]",
  indigo: "bg-[linear-gradient(135deg,#4338ca,#818cf8)] shadow-[0_8px_18px_-10px_rgba(67,56,202,0.9)]",
  slate: "bg-[linear-gradient(135deg,#475569,#94a3b8)] shadow-[0_8px_18px_-10px_rgba(71,85,105,0.9)]",
};

/** A soft wash and readable text in the tone (pills, small highlights). */
export const TONE_SOFT: Record<KitTone, string> = {
  blue: "bg-[#2f6bff]/10 text-[#1f55d6] dark:bg-[#2f6bff]/20 dark:text-[#8db0ff]",
  violet: "bg-[#7b5cff]/12 text-[#5b3fd9] dark:bg-[#7b5cff]/22 dark:text-[#b7a6ff]",
  green: "bg-[#0f7a4a]/10 text-[#0f7a4a] dark:bg-[#5fd9a0]/14 dark:text-[#5fd9a0]",
  orange: "bg-[#f97316]/12 text-[#b45309] dark:bg-[#fbbf24]/14 dark:text-[#ffc65c]",
  pink: "bg-[#db2777]/10 text-[#be185d] dark:bg-[#f472b6]/16 dark:text-[#f9a8d4]",
  red: "bg-[#c81e3a]/10 text-[#c81e3a] dark:bg-[#ff7a8f]/14 dark:text-[#ff7a8f]",
  teal: "bg-[#0e7490]/10 text-[#0e7490] dark:bg-[#22d3ee]/14 dark:text-[#67e8f9]",
  indigo: "bg-[#4338ca]/10 text-[#4338ca] dark:bg-[#818cf8]/18 dark:text-[#a5b4fc]",
  slate: "bg-[#475569]/10 text-[#475569] dark:bg-white/10 dark:text-[#cbd5e1]",
};

/** The card surface every kit card shares: white on the grey page, a lifted tone in dark mode. */
export const CARD = "rounded-[22px] border border-line bg-surface shadow-[0_18px_40px_-34px_rgba(17,24,39,0.5)] dark:bg-white/[0.035] dark:shadow-none";

/** Hover lift for cards that are links (off under reduced motion). */
export const LIFT =
  "transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-pulse-blue/35 hover:shadow-[0_22px_44px_-30px_rgba(47,107,255,0.45)] motion-reduce:transform-none motion-reduce:transition-none";

/** The focus ring for kit links and buttons. */
export const FOCUS = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30";
