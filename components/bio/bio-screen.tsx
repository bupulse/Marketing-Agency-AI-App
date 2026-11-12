import { Link2 } from "lucide-react";
import type { ComponentProps } from "react";
import { KitStyles, PageHeader } from "@/components/admin/kit";
import { BioSettingsForm } from "./bio-settings";

/** The Link in bio page (plain data in, so the page and the dev preview draw the same). */
export function BioScreen(props: ComponentProps<typeof BioSettingsForm>) {
  return (
    <div className="flex flex-col gap-6">
      <KitStyles />
      <PageHeader icon={Link2} title="Link in bio" description="A free page with your WhatsApp button, prices and location. Put its link in your Instagram or TikTok bio instead of “DM for price”." />
      <BioSettingsForm {...props} />
    </div>
  );
}
