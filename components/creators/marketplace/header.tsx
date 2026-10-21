import Link from "next/link";
import { BackgroundBlobs } from "@/components/motion";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme";
import { buttonClasses } from "@/components/ui";

export type HeaderViewer = "guest" | "creator" | "company";

/**
 * The frame of the creators' public pages (/creators, /creators/signup, /c/<slug>): the logo, and Sign in / Join as a
 * creator for visitors, or a way back to their own pages for signed-in people. Phone first.
 */
export function CreatorsFrame({ viewer, children }: { viewer: HeaderViewer; children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh">
      <BackgroundBlobs />
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-4 pt-5 sm:px-6">
        <Link href="/creators" aria-label="BuPulse for creators" className="inline-flex min-h-11 items-center gap-2">
          <Logo height={28} priority />
          <span className="rounded-full bg-new-bg px-2.5 py-1 text-xs font-semibold text-new">Creators</span>
        </Link>
        <div className="flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          {viewer === "creator" ? (
            <Link href="/creator" className={buttonClasses({ size: "sm", variant: "ghost", className: "whitespace-nowrap px-3" })}>My campaigns</Link>
          ) : viewer === "company" ? (
            <Link href="/dashboard" className={buttonClasses({ size: "sm", variant: "ghost", className: "whitespace-nowrap px-3" })}>Dashboard</Link>
          ) : (
            <>
              <Link href="/login?next=/creator" className="inline-flex min-h-11 items-center px-2 text-sm font-semibold no-underline">Sign in</Link>
              <Link href="/creators/signup" className={buttonClasses({ size: "sm" })}>Join</Link>
            </>
          )}
        </div>
      </header>
      {children}
    </div>
  );
}
