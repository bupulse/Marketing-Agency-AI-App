// Shared Tailwind classes for the Mail console pages (the design's glass panels, inputs and buttons).

export const panel = "rounded-[24px] border border-white/80 bg-white/[0.72] backdrop-blur-[26px] backdrop-saturate-[1.8] dark:border-white/10 dark:bg-[rgba(28,28,34,0.78)]";
export const card = "flex flex-col gap-1.5 rounded-[22px] border border-white/80 bg-white/70 p-[18px] backdrop-blur-[26px] backdrop-saturate-[1.8] dark:border-white/10 dark:bg-[rgba(28,28,34,0.78)]";
export const h1 = "m-0 text-[30px] font-bold tracking-[-0.025em]";
export const sub = "mt-1 text-[15px] leading-normal text-[#3c3c43] dark:text-white/70";
export const h2 = "m-0 text-[17px] font-semibold";
export const label = "flex flex-col gap-[7px] text-[13.5px] font-semibold";
export const hint = "text-[12.5px] font-normal text-[#5c5c63] dark:text-white/60";
export const input = "h-[46px] w-full rounded-xl border border-[rgba(60,60,67,0.2)] bg-white/[0.92] px-3.5 text-[15px] font-normal outline-none focus:border-[#2f6bff] focus:ring-2 focus:ring-[#2f6bff]/25 dark:border-white/15 dark:bg-white/5";
export const darkBtn = "inline-flex h-11 cursor-pointer items-center gap-2 rounded-full bg-[#1d1d1f] px-5 text-[15px] font-semibold text-white transition hover:bg-black disabled:opacity-60 dark:bg-white dark:text-[#1d1d1f]";
export const ghostBtn = "inline-flex h-11 cursor-pointer items-center rounded-full bg-white/75 px-5 text-[15px] font-medium hover:bg-white dark:bg-white/10 dark:hover:bg-white/15";
export const smallBtn = "inline-flex h-8 cursor-pointer items-center rounded-full border border-black/15 px-3 text-[12.5px] font-medium hover:bg-black/5 disabled:opacity-60 dark:border-white/15 dark:hover:bg-white/10";
export const pill = "inline-flex h-6 items-center rounded-full px-[9px] text-[12.5px] font-semibold";
export const muted = "text-[#3c3c43] dark:text-white/70";

export const STATUS_STYLE: Record<string, string> = {
  active: "bg-[#e2f5ea] text-[#11633a] dark:bg-[#11633a]/40 dark:text-[#9fe0bb]",
  invited: "bg-[#e3ecff] text-[#1946b8] dark:bg-[#1946b8]/40 dark:text-[#b9ccff]",
  suspended: "bg-[#ececf1] text-[#3c3c43] dark:bg-white/10 dark:text-white/70",
};
