import { Phone } from "lucide-react";
import { PageHero } from "@/components/marketing/pages/page-hero";
import { pageMetadata } from "@/components/marketing/pages/seo";
import { QuoteForm } from "@/components/marketing/quote/quote-form";
import { Container } from "@/components/ui";
import { cleanQuoteSource, QUOTE_PAGE_SOURCE } from "@/lib/quote/source";

// The quote form on its own page, for the link in BuPulse's Instagram, Facebook and TikTok bios: /quote?src=instagram
// records where the person came from (lib/quote/source.ts). Anyone can use it, from any country; the pop-up on the
// other pages is the same form.

export const metadata = pageMetadata({
  title: "Get a free quote",
  description: "Tell us about your business and BuPulse calls you back shortly with a free quote for your marketing: posts, graphics and website chat.",
  path: "/quote",
});

export default async function QuotePage({ searchParams }: { searchParams: Promise<{ src?: string | string[]; utm_source?: string | string[] }> }) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const source = cleanQuoteSource(first(sp.src) ?? first(sp.utm_source), QUOTE_PAGE_SOURCE);
  const pageUrl = source === QUOTE_PAGE_SOURCE ? "/quote" : `/quote?src=${encodeURIComponent(source)}`;
  return (
    <>
      <PageHero eyebrow="Free quote" title="Get a free quote" text="Tell us about your business in a minute. We call you back shortly with a price that fits what you need." />
      <Container size="narrow" className="flex flex-col gap-6 pb-24">
        <QuoteForm source={source} pageUrl={pageUrl} framed />
        <p className="flex items-center justify-center gap-2 text-center text-muted">
          <Phone aria-hidden className="size-4 shrink-0" />
          No commitment: a short call to understand your business, then your quote.
        </p>
      </Container>
    </>
  );
}
