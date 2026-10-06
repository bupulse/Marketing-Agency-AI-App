import Link from "next/link";
import { Logo } from "@/components/brand";
import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui";
import { navLinks } from "@/lib/content/site";
import { MobileMenu } from "./mobile-menu";

/** Sticky glass navigation. Desktop shows links and CTAs; phones get a disclosure menu. */
export function SiteHeader() {
  return (
    <header className="sticky top-3 z-30 px-3 pt-3 sm:top-4 sm:px-6">
      <nav
        aria-label="Main"
        className="glass relative mx-auto flex max-w-6xl items-center gap-3 rounded-3xl py-2 pr-2 pl-4 sm:pl-5"
      >
        <Link href="/" aria-label="BuPulse home" className="flex min-h-11 items-center">
          <Logo height={30} priority />
        </Link>
        <ul className="m-0 ml-6 hidden flex-1 list-none items-center gap-1 p-0 md:flex">
          {navLinks.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-text no-underline opacity-80 transition-opacity hover:opacity-100"
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Button href="/login" variant="ghost" size="sm" className="hidden md:inline-flex">
            Log in
          </Button>
          <Button href="/signup" size="sm" className="hidden md:inline-flex">
            Start free trial
          </Button>
          <MobileMenu links={navLinks} />
        </div>
      </nav>
    </header>
  );
}
