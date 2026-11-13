import type { ReactNode } from "react";
import { Container } from "@/components/ui";
import { PageHero } from "./page-hero";

export const LAST_UPDATED = "6 October 2026";

/** `updated` overrides LAST_UPDATED for a page changed on its own (the privacy and data deletion pages). */
export function LegalPage({ title, intro, updated, children }: { title: string; intro: ReactNode; updated?: string; children: ReactNode }) {
  return (
    <>
      <PageHero eyebrow="Legal" title={title} text={intro} />
      <Container size="narrow" className="pb-24">
        <p className="mb-8 text-sm font-medium text-muted">Last updated: {updated ?? LAST_UPDATED}</p>
        <div className="legal flex flex-col gap-4 text-[16.5px] leading-[1.75]">{children}</div>
      </Container>
    </>
  );
}

export function LegalSection({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-28 flex-col gap-4">
      <h2 className="mt-8 text-2xl font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-6 marker:text-pulse-blue">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
