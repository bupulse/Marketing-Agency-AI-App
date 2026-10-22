import Link from "next/link";
import { ThemeToggle } from "@/components/theme";
import { buttonClasses } from "@/components/ui";
import { CompanyLogo } from "@/components/creators/marketplace/campaign-card";
import type { HeaderViewer } from "@/components/creators/marketplace/header";
import { brandVars, type BrandLook } from "@/lib/creators/brand-look";
import type { SignedAsset } from "@/lib/creators/campaign-files";

/**
 * The frame of a campaign's application page /c/<slug> in the company's look (docs/CREATOR_CAMPAIGN_WIZARD.md,
 * "Branding"): its logo and name at the top, its colours as CSS variables (--brand, --brand-2, --on-brand) for the
 * form, the cover photo or video picked on the Look step, and a small "Powered by BuPulse" at the bottom.
 */
export function BrandedFrame({ look, company, cover, viewer, back, children }: { look: BrandLook; company: { name: string; logoUrl: string | null }; cover: SignedAsset | null; viewer: HeaderViewer; back: string; children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh bg-bg" style={brandVars(look) as React.CSSProperties}>
      <div aria-hidden className="absolute inset-x-0 top-0 h-56 opacity-25" style={{ backgroundImage: "linear-gradient(160deg, var(--brand), var(--brand-2) 55%, transparent)" }} />
      <header className="relative mx-auto flex w-full max-w-3xl items-center justify-between gap-2 px-4 pt-4 sm:px-6">
        <span className="flex min-w-0 items-center gap-2.5">
          <CompanyLogo name={company.name} url={company.logoUrl} size={40} />
          <span className="truncate text-[15px] font-semibold">{company.name}</span>
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          {viewer === "creator" ? (
            <Link href="/creator" className={buttonClasses({ size: "sm", variant: "ghost", className: "whitespace-nowrap px-3" })}>My campaigns</Link>
          ) : viewer === "company" ? (
            <Link href="/dashboard" className={buttonClasses({ size: "sm", variant: "ghost", className: "whitespace-nowrap px-3" })}>Dashboard</Link>
          ) : (
            <Link href={`/login?next=${encodeURIComponent(back)}`} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold no-underline">Sign in</Link>
          )}
        </div>
      </header>
      {cover && (
        <div className="relative mx-auto mt-4 w-full max-w-3xl px-4 sm:px-6">
          {cover.kind === "video" ? (
            <video src={cover.url} poster={cover.posterUrl ?? undefined} autoPlay muted loop playsInline preload="metadata" aria-label={`${company.name}: campaign video`} className="aspect-[4/3] w-full rounded-glass bg-soft object-cover sm:aspect-video" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed Storage URL
            <img src={cover.url} alt="" fetchPriority="high" className="aspect-[4/3] w-full rounded-glass bg-soft object-cover sm:aspect-video" />
          )}
        </div>
      )}
      <div className="relative">{children}</div>
      <footer className="relative pb-8 text-center text-xs text-muted">
        Powered by{" "}
        <Link href="/creators" className="font-semibold underline">
          BuPulse
        </Link>
      </footer>
    </div>
  );
}
