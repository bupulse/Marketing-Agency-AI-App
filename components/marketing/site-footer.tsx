import Link from "next/link";
import { Logo } from "@/components/brand";
import { Container } from "@/components/ui";
import { footerLinks } from "@/lib/content/site";

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <Container className="flex flex-col items-start gap-6 py-10 lg:flex-row lg:items-center lg:justify-between">
        <Link href="/" aria-label="BuPulse home" className="flex min-h-11 items-center">
          <Logo height={26} />
        </Link>
        <nav aria-label="Footer">
          <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0">
            {footerLinks.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="inline-flex min-h-11 items-center text-sm font-medium text-text no-underline opacity-80 hover:opacity-100"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="m-0 text-[13px] text-muted">© 2026 BuPulse · bupulse.com</p>
      </Container>
    </footer>
  );
}
