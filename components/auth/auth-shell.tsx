import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarCheck, CreditCard, Sparkles } from "lucide-react";
import { BackgroundBlobs } from "@/components/motion";
import { ThemeToggle } from "@/components/theme";
import { GlassCard } from "@/components/ui";

const FACTS = [
  { icon: CalendarCheck, text: "Your free trial starts when you choose a plan" },
  { icon: CreditCard, text: "No credit card needed to start" },
  { icon: Sparkles, text: "Posts, images and ads in your brand voice" },
];

/** Split layout shared by /login, /signup, /forgot-password and /reset-password: brand side + glass card. */
export function AuthShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="relative grid min-h-dvh w-full lg:grid-cols-[1.05fr_1fr]">
      <BackgroundBlobs />

      <section
        aria-label="About BuPulse"
        className="relative flex flex-col justify-between gap-10 overflow-hidden bg-brand-gradient px-6 py-8 text-white sm:px-10 lg:px-14 lg:py-12"
      >
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="BuPulse home" className="inline-flex min-h-11 items-center">
            <Image src="/brand/logo-white.png" alt="BuPulse" width={107} height={32} priority style={{ width: 107, height: 32 }} />
          </Link>
        </div>
        <div className="flex flex-col gap-6">
          <p className="max-w-md text-3xl font-semibold leading-tight tracking-[-0.03em] sm:text-4xl">
            The marketing team for every small business.
          </p>
          <ul className="flex flex-col gap-3">
            {FACTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-[15px] font-medium">
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/20">
                  <Icon aria-hidden className="size-[18px]" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="hidden text-sm text-white/80 lg:block">Shops, schools, salons, builders and more.</p>
      </section>

      <main className="relative flex flex-col items-center justify-center gap-6 px-4 pb-10 pt-20 sm:px-8 lg:py-10">
        <div className="absolute right-4 top-4 sm:right-8 sm:top-6">
          <ThemeToggle />
        </div>
        <GlassCard
          strong
          padding="lg"
          className={`flex w-full ${wide ? "max-w-lg" : "max-w-md"} flex-col gap-6 p-6 sm:p-8`}
        >
          {children}
        </GlassCard>
      </main>
    </div>
  );
}

export function AuthTerms() {
  return (
    <p className="text-xs text-muted">
      By continuing you agree to our <Link href="/terms" className="underline">Terms</Link> and{" "}
      <Link href="/privacy" className="underline">Privacy Policy</Link>.
    </p>
  );
}
