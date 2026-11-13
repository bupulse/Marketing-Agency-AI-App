import type { ReactNode } from "react";
import { KitStyles, PageHeader } from "@/components/admin/kit";
import { SECTION_ICONS } from "@/components/knowledge/section-icons";
import type { SectionKey } from "@/lib/knowledge/sections";

/** The top of a Business info section page: back to Business info, the section's icon, title, one line, its buttons. */
export function SectionHeader({ section, title, description, action }: { section: SectionKey; title: string; description?: string; action?: ReactNode }) {
  return (
    <>
      <KitStyles />
      <PageHeader icon={SECTION_ICONS[section]} title={title} description={description} actions={action} back={{ href: "/dashboard/knowledge", label: "Business info" }} />
    </>
  );
}
