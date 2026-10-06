import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand";
import { BackgroundBlobs } from "@/components/motion";
import { ThemeToggle } from "@/components/theme";
import { GlassCard } from "@/components/ui";

/** Centred full-page layout for /onboarding: logo, theme toggle and one glass card. */
export function OnboardingShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh w-full flex-col items-center px-4 pb-10 sm:px-8">
      <BackgroundBlobs />
      <header className="relative flex w-full max-w-2xl items-center justify-between py-4 sm:py-6">
        <Link href="/" aria-label="BuPulse home" className="inline-flex min-h-11 items-center">
          <Logo height={32} priority />
        </Link>
        <ThemeToggle />
      </header>
      <main className="relative flex w-full max-w-2xl flex-1 flex-col">
        <GlassCard strong padding="lg" className="flex w-full flex-col gap-6 p-6 sm:p-8">
          {children}
        </GlassCard>
      </main>
    </div>
  );
}
