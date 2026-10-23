import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme";
import { SupportBrand } from "./brand";

/**
 * The sign-in pages: the brand gradient behind a white card in light mode; in dark mode a dark page with the gradient
 * only as a glow (owner, 23 Oct).
 */
export function SupportAuthShell({ step, title, intro, children }: { step?: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <main className="relative flex min-h-dvh flex-col items-center gap-7 bg-[linear-gradient(135deg,#2f6bff,#7b5cff)] px-4 py-10 dark:bg-[#0b0b0f] dark:bg-[radial-gradient(60%_40%_at_50%_0%,rgba(47,107,255,0.28),transparent),radial-gradient(50%_40%_at_80%_100%,rgba(123,92,255,0.22),transparent)]">
      <div className="absolute right-4 top-4">
        <ThemeToggle className="text-white dark:text-text" />
      </div>
      <SupportBrand size="lg" className="text-white" />
      <section className="flex w-full max-w-[400px] flex-col gap-4 rounded-[24px] bg-white p-6 text-graphite shadow-[0_24px_60px_-24px_rgba(11,11,15,0.45)] dark:bg-[#16161c] dark:text-cloud dark:ring-1 dark:ring-white/10">
        {step && <span className="text-xs font-bold tracking-[0.04em] text-muted">{step}</span>}
        <h1 className="text-[22px] font-bold tracking-[-0.02em]">{title}</h1>
        {intro && <div className="text-[15px] text-muted">{intro}</div>}
        {children}
      </section>
    </main>
  );
}

export const alertClass = "rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger";
export const noteClass = "rounded-2xl bg-soft px-4 py-3 text-sm text-text";
