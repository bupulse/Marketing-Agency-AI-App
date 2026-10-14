// The "Get started" list on the dashboard home. Pure, so the plan and role rules are tested without a database.
import type { FeatureKey } from "@/lib/features";
import { askMessage, can, type Permission, type Role } from "@/lib/team/roles";

export type ChecklistItem = {
  label: string;
  done: boolean;
  href: string;
  /** Set when the signed-in role may not open the page: the item is shown without a link, with who to ask. */
  ask: string | null;
};

export function homeChecklist(input: {
  role: Role;
  inPlan: ReadonlySet<FeatureKey>;
  brandDone: boolean;
  connections: number;
  products: number;
  /** lib/widget/seen.ts widgetInstalled. */
  widgetInstalled: boolean;
}): ChecklistItem[] {
  const items: (Omit<ChecklistItem, "ask"> & { permission?: Permission })[] = [
    { label: "Complete your brand profile", done: input.brandDone, href: "/dashboard/brand", permission: "settings" },
    { label: "Connect a social account", done: input.connections > 0, href: "/dashboard/connections", permission: "channels" },
    {
      label: "Add your first product or service",
      done: input.products > 0,
      href: input.products > 0 ? "/dashboard/knowledge/products" : "/dashboard/knowledge/products/new",
    },
    // Only plans with website chat have a widget to install.
    ...(input.inPlan.has("websiteChat")
      ? [{ label: "Install the chat widget", done: input.widgetInstalled, href: "/dashboard/widget", permission: "widget" as const }]
      : []),
  ];
  return items.map(({ permission, ...item }) => ({ ...item, ask: permission && !can(input.role, permission) ? askMessage(permission) : null }));
}
