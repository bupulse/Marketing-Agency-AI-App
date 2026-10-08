import type { ReactNode } from "react";
import { BackgroundBlobs } from "@/components/motion";
import { Logo } from "@/components/brand";
import { ThemeToggle } from "@/components/theme";
import { GlassCard } from "@/components/ui";

/** Centred card for the two admin sign-in steps. */
export function AdminAuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4 py-10">
      <BackgroundBlobs />
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <GlassCard strong padding="lg" className="relative flex w-full max-w-md flex-col gap-6">
        <Logo height={28} />
        {children}
      </GlassCard>
    </main>
  );
}
