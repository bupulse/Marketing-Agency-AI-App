import Link from "next/link";
import { Logo } from "@/components/brand";
import { ThemeToggle } from "@/components/theme";
import { navLinks } from "@/lib/content/site";
import { HeaderActions } from "./header-actions";

/**
 * Sticky glass navigation. From lg (1024 px) the links and both buttons fit on one line; below that the links and
 * Log in move into the menu, while the theme toggle and the demo button stay (the button from sm, 640 px; on phones it
 * is in the menu, so the menu button always fits). Labels never wrap. Signed in, Log in becomes the Account menu (HeaderActions).
 */
export function SiteHeader() {
  return (
    <header className="sticky top-3 z-30 px-3 pt-3 sm:top-4 sm:px-6">
      <nav
        aria-label="Main"
        className="glass relative mx-auto flex max-w-6xl items-center gap-3 rounded-3xl py-2 pr-2 pl-4 sm:pl-5"
      >
        <Link href="/" aria-label="BuPulse home" className="flex min-h-11 shrink-0 items-center">
          <Logo height={30} priority />
        </Link>
        <ul className="m-0 ml-4 hidden flex-1 list-none items-center gap-0.5 p-0 lg:flex xl:ml-6 xl:gap-1">
          {navLinks.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-2.5 text-sm font-medium text-text no-underline opacity-80 transition-opacity hover:opacity-100 xl:px-3"
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <HeaderActions links={navLinks} />
        </div>
      </nav>
    </header>
  );
}
