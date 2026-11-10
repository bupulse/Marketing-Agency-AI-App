import type { ReactNode } from "react";
import { Gauge } from "lucide-react";
import type { AdminNavGroup } from "../nav";
import { KitStyles } from "./kit-styles";
import { PageHeader } from "./page-header";
import { SectionCard, SectionGrid } from "./section-card";

/** One card's extras on a hub: a key number with its words, and a to-do bubble. */
export type HubFigure = { value?: ReactNode; valueLabel?: ReactNode; count?: number; countTone?: "danger" | "violet" | "neutral"; countLabel?: string };

/**
 * A group's landing page: the group's header (icon, title, one-line hint) and one section card per page the viewer
 * may open (pass the group already filtered by navFor). `figures` adds a key number or a to-do bubble per page href.
 */
export function HubView({ group, figures = {}, children }: { group: AdminNavGroup; figures?: Record<string, HubFigure>; children?: ReactNode }) {
  const tone = group.tone ?? "blue";
  return (
    <>
      <KitStyles />
      <PageHeader icon={group.icon ?? Gauge} tone={tone} title={group.title ?? "Admin"} description={group.hint} eyebrow="Admin area" />
      {children}
      <SectionGrid>
        {group.items.map((i) => {
          const f = figures[i.href] ?? {};
          return <SectionCard key={i.href} href={i.href} icon={i.icon} tone={tone} title={i.label} hint={i.description} value={f.value} valueLabel={f.valueLabel} count={f.count} countTone={f.countTone} countLabel={f.countLabel} row />;
        })}
      </SectionGrid>
    </>
  );
}
