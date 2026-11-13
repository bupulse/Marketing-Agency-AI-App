import { BookUser } from "lucide-react";
import type { ComponentProps } from "react";
import { KitStyles, PageHeader } from "@/components/admin/kit";
import { ContactsList } from "./contacts-list";

/** The Contacts page (plain data in, so the page and the dev preview draw the same). */
export function ContactsScreen(props: ComponentProps<typeof ContactsList>) {
  return (
    <div className="flex flex-col gap-6">
      <KitStyles />
      <PageHeader icon={BookUser} title="Contacts" description="Everyone who wrote to you, on any channel. Tap a name to see their details and messages." />
      <ContactsList {...props} />
    </div>
  );
}
