import { Mail } from "lucide-react";
import { ContactForm } from "@/components/marketing/pages/contact-form";
import { PageHero } from "@/components/marketing/pages/page-hero";
import { pageMetadata } from "@/components/marketing/pages/seo";
import { Container } from "@/components/ui";
import { site } from "@/lib/content/site";

export const metadata = pageMetadata({
  title: "Contact",
  description: "Questions about BuPulse? Send us a message and we will reply by email.",
  path: "/contact",
});

export default function ContactPage() {
  return (
    <>
      <PageHero eyebrow="Contact" title="Talk to us" text="Questions, feedback or something not working? Send a message and a real person will reply." />
      <Container size="narrow" className="flex flex-col gap-6 pb-24">
        <ContactForm
          kind="contact"
          industries={[]}
          submitLabel="Send message"
          messageHint="Tell us what you need help with."
          successTitle="Thank you, we got your message"
          successText="We usually reply within one or two working days."
        />
        <p className="flex items-center justify-center gap-2 text-muted">
          <Mail aria-hidden className="size-4" />
          Prefer email?
          <a className="font-semibold text-[color:var(--bp-link)] underline" href={`mailto:${site.email}`}>
            {site.email}
          </a>
        </p>
      </Container>
    </>
  );
}
