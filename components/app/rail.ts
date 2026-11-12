// The Marketing dashboard's left menu ("the rail"), matching the support app's sidebar (owner, 12 November 2026: "the
// left menu ... look like the one in support"): BuPulse's blue-to-violet gradient with white text in light mode, a
// dark tone with gradient accents in dark mode. Full Tailwind class strings (never built from pieces), shared by the
// computer sidebar and the phone drawer so both look the same.
//
// The gradient is a slightly deeper cut of the brand's #2f6bff -> #7b5cff, so white text (and the 85% white group
// titles) passes WCAG AA contrast from top to bottom: about 6.2:1 on the blue end and 6.5:1 on the violet end.

/** The rail's background and text colour. `bp-rail` gives its focus rings a white outline (app/globals.css). */
export const RAIL = "bp-rail bg-[linear-gradient(165deg,#2152e0,#5a3fe0)] text-white dark:bg-none dark:bg-[#111117]";

/** The active page's pill in dark mode and the dark Create button: the same deep gradient. */
const DEEP = "dark:bg-[linear-gradient(120deg,#2152e0,#5a3fe0)]";

/** A menu row (link or button). */
export const RAIL_ROW =
  "group relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-[14px] no-underline transition-colors duration-200";

/** A row's colours: the open page is a white pill with brand-blue text (a gradient pill in dark mode). */
export const RAIL_ON = `bg-white font-semibold text-[#1f55d6] shadow-[0_8px_20px_-12px_rgba(0,0,0,0.45)] ${DEEP} dark:text-white`;
export const RAIL_OFF = "font-medium text-white hover:bg-white/12 dark:text-white/85 dark:hover:bg-white/[0.07] dark:hover:text-white";

/** A group's small title. */
export const RAIL_TITLE = "px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/85 dark:text-white/55";

/** A soft panel on the rail (the company, the plan box, Find a page). */
export const RAIL_PANEL = "bg-white/12 dark:bg-white/[0.05]";

/** The Create button: white on the gradient, the gradient on the dark rail. */
export const RAIL_CREATE = `bg-white text-[#1f55d6] shadow-[0_10px_24px_-14px_rgba(0,0,0,0.55)] hover:bg-white/92 ${DEEP} dark:text-white dark:hover:brightness-110`;
