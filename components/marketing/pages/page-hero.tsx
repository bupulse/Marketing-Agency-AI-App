import type { ReactNode } from "react";
import { BackgroundBlobs } from "@/components/motion";
import { Container, SectionHeading } from "@/components/ui";

/** Top of a secondary page: soft blobs, eyebrow, the page's one H1 and an intro line. */
export function PageHero({ eyebrow, title, text, children }: { eyebrow?: string; title: ReactNode; text?: ReactNode; children?: ReactNode }) {
  return (
    <section className="relative isolate overflow-hidden pt-16 pb-12 sm:pt-24 sm:pb-16">
      <div aria-hidden className="absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,black_40%,transparent)]">
        <BackgroundBlobs mode="section" />
      </div>
      <Container className="flex flex-col items-center gap-8">
        <SectionHeading as="h1" eyebrow={eyebrow} title={title} text={text} className="max-w-3xl" />
        {children}
      </Container>
    </section>
  );
}
