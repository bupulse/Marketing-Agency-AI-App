import { Plus, Workflow } from "lucide-react";
import { KitStyles, PageHeader } from "@/components/admin/kit";
import { Button } from "@/components/ui";
import type { AutomationRow } from "@/lib/automations/service";
import { AutomationsList, TemplatePicker } from "./automations-list";

/**
 * The Automations page (plain data in, so the page and the dev preview draw the same). With automations: the list and
 * "New automation", which opens the templates on their own page. Without any: the templates straight away.
 */
export function AutomationsScreen({ automations, canEdit, socialReady, newHref = "/dashboard/automations/new" }: { automations: AutomationRow[]; canEdit: boolean; socialReady: boolean; newHref?: string }) {
  const has = automations.length > 0;
  return (
    <div className="flex flex-col gap-6">
      <KitStyles />
      <PageHeader
        icon={Workflow}
        title="Automations"
        description="Answer messages and comments for you: send prices, ask questions, book visits and hand people to your team."
        actions={has && canEdit ? <Button href={newHref} leading={<Plus aria-hidden className="size-4" />}>New automation</Button> : undefined}
      />
      {has ? <AutomationsList automations={automations} canEdit={canEdit} /> : <TemplatePicker canEdit={canEdit} socialReady={socialReady} />}
    </div>
  );
}

/** "New automation": the template cards on their own page. */
export function NewAutomationScreen({ canEdit, socialReady, backHref = "/dashboard/automations" }: { canEdit: boolean; socialReady: boolean; backHref?: string }) {
  return (
    <div className="flex flex-col gap-6">
      <KitStyles />
      <PageHeader icon={Workflow} title="New automation" description="Start from a ready one and change the words. You can test it before it goes live." back={{ href: backHref, label: "Automations" }} />
      <TemplatePicker canEdit={canEdit} socialReady={socialReady} />
    </div>
  );
}
