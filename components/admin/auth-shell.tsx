import type { ReactNode } from "react";
import { BrandLockup } from "@/components/brand/lockup";
import { ThemeToggle } from "@/components/theme";
import { GlassCard } from "@/components/ui";

/** Centred card for the admin sign-in steps: BuPulse's real logo and "Admin" on a plain calm page (as the console). */
export function AdminAuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <GlassCard strong padding="lg" className="relative flex w-full max-w-md flex-col gap-6">
        <BrandLockup service="Admin" height={32} eager className="self-start" />
        {children}
      </GlassCard>
    </main>
  );
}
