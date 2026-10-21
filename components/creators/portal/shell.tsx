import Link from "next/link";
import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { BackgroundBlobs } from "@/components/motion";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme";
import { CreatorNav } from "./nav";

/**
 * The creator's portal frame (/creator): BuPulse's look, but none of the company dashboard. Phone first: a top bar,
 * the page, and the three tabs at the bottom (at the top from the sm breakpoint).
 */
export function CreatorShell({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="relative min-h-dvh">
      <BackgroundBlobs />
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 pt-4 sm:px-6">
        <Link href="/creator" aria-label="Your campaigns" className="inline-flex min-h-11 items-center gap-2">
          <Logo height={26} priority />
          <span className="rounded-full bg-new-bg px-2.5 py-1 text-xs font-semibold text-new">Creator</span>
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <form action="/auth/signout" method="post">
            <button type="submit" aria-label={`Sign out ${name}`} className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-soft hover:text-text">
              <LogOut aria-hidden className="size-5" />
            </button>
          </form>
        </div>
      </header>
      <div className="mx-auto hidden w-full max-w-3xl px-4 pt-3 sm:block sm:px-6">
        <CreatorNav />
      </div>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:pb-16">{children}</main>
      <div className="fixed inset-x-0 bottom-0 z-40 rounded-t-[24px] border border-b-0 border-line bg-surface px-2 pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-1.5 shadow-glass sm:hidden">
        <CreatorNav bottom />
      </div>
    </div>
  );
}
