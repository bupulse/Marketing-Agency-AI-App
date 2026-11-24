import { cn } from "@/lib/cn";
import { BMark } from "./brand";

// The B Mail preloader (owner: "app open + small pulse"): the full screen version while B Mail opens, and a small one
// in the reading area while a conversation or a list loads. Server components: they show before any JavaScript runs.

const LINE = "M0 34H120L140 10L160 52L178 22L192 34H360";

export function MailPreloader({ label = "Opening your mail…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className="bmail-preloader fixed inset-0 z-[60] flex flex-col items-center justify-center gap-[26px]">
      <div className="relative flex size-[150px] items-center justify-center">
        <span aria-hidden className="bmail-ring absolute inset-0 rounded-full border-2 border-[rgba(47,107,255,0.45)]" />
        <span aria-hidden className="bmail-ring bmail-ring-late absolute inset-0 rounded-full border-2 border-[rgba(123,92,255,0.4)]" />
        <span aria-hidden className="absolute inset-[14px] rounded-full border border-white/90 bg-white/70 shadow-[0_24px_50px_-24px_rgba(47,107,255,0.6)] backdrop-blur-xl dark:border-white/10 dark:bg-white/10" />
        <BMark size={104} className="bmail-breathe relative text-[#010106] dark:text-white" />
      </div>
      <svg aria-hidden width="360" height="60" viewBox="0 0 360 60" className="max-w-[80vw]">
        <defs>
          <linearGradient id="bmail-pre-line" x1="0" x2="1"><stop offset="0" stopColor="#2f6bff" /><stop offset="1" stopColor="#7b5cff" /></linearGradient>
        </defs>
        <path d={LINE} fill="none" stroke="rgba(47,107,255,0.12)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <path className="bmail-draw" d={LINE} fill="none" stroke="url(#bmail-pre-line)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="180 340" />
      </svg>
      <span className="bmail-fade text-[15px] font-medium tracking-[0.01em] text-[#3c3c43] dark:text-white/75">{label}</span>
    </div>
  );
}

/** Inside the shell: the mark with its pulse and a thin moving bar, where the list or the conversation will be. */
export function MailPanePreloader({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className={cn("bmail-pop flex min-h-[60vh] flex-col items-center justify-center gap-4 rounded-[22px] border border-white/70 bg-white/[0.78] backdrop-blur-2xl dark:border-white/10 dark:bg-[rgba(28,28,34,0.78)]", className)}>
      <div className="relative flex size-20 items-center justify-center">
        <span aria-hidden className="bmail-ring absolute inset-0 rounded-full border-2 border-[rgba(47,107,255,0.35)]" />
        <BMark size={52} className="bmail-breathe relative text-[#010106] dark:text-white" />
      </div>
      <span aria-hidden className="relative h-1 w-40 overflow-hidden rounded-full bg-[rgba(47,107,255,0.12)]">
        <span className="bmail-bar absolute inset-y-0 left-0 w-2/5 rounded-full bg-gradient-to-r from-[#2f6bff] to-[#7b5cff]" />
      </span>
      <span className="text-[13.5px] font-medium text-[#3c3c43] dark:text-white/70">{label}</span>
    </div>
  );
}
