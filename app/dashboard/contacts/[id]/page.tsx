import { notFound } from "next/navigation";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { ContactDetail } from "@/components/contacts/contact-detail";
import { can } from "@/lib/team/roles";
import { getContact, listContacts, listFields } from "@/lib/contacts/service";

export const metadata = { title: "Contact" };

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const blocked = await featureGate("inbox");
  if (blocked) return blocked;
  const { business, role } = await getAppContext();
  const { id } = await params;
  const contact = await getContact(business.id, id.slice(0, 60));
  if (!contact) notFound();
  // People who might be the same person (same name), offered for merging.
  const [fields, similar] = await Promise.all([
    listFields(business.id),
    contact.name ? listContacts(business.id, { q: contact.name }, 6).then((r) => r.items.filter((c) => c.id !== contact.id)) : Promise.resolve([]),
  ]);
  return <ContactDetail contact={contact} fields={fields} similar={similar} canManage={can(role, "settings")} />;
}
