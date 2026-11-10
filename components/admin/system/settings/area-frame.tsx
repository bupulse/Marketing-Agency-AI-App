import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { PageHeader, type KitTone } from "@/components/admin/kit";
import { Notices } from "../notices";

/** The top of every settings page: its header with a way back to the Settings cards, and the save message. */
export function AreaFrame({ icon, tone, title, description, actions, ok, bad, children }: { icon: LucideIcon; tone: KitTone; title: string; description: ReactNode; actions?: ReactNode; ok?: string; bad?: string; children: ReactNode }) {
  return (
    <>
      <PageHeader icon={icon} tone={tone} title={title} description={description} actions={actions} back={{ href: "/admin/settings", label: "Settings" }} />
      <Notices ok={ok} bad={bad} />
      {children}
    </>
  );
}

/** A plain "how it works" list for an ExpandCard. */
export function HowItWorks({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-snug text-muted marker:text-pulse-blue">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
