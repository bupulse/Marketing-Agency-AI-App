import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { ContactsList } from "@/components/contacts/contacts-list";
import { can } from "@/lib/team/roles";
import { PAGE_SIZE, listContacts, listFields, listTags } from "@/lib/contacts/service";
import { isChannelKind } from "@/lib/inbox/labels";

export const metadata = { title: "Contacts" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ContactsPage({ searchParams }: { searchParams: SearchParams }) {
  const blocked = await featureGate("inbox");
  if (blocked) return blocked;
  const { business, role } = await getAppContext();
  const params = await searchParams;
  const q = (one(params.q) ?? "").slice(0, 100);
  const tag = one(params.tag)?.slice(0, 40) || null;
  const channelParam = one(params.channel);
  const channel = isChannelKind(channelParam) ? channelParam : null;
  const requested = Number(one(params.limit));
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.ceil(requested), 1000) : PAGE_SIZE;
  const [list, tags, fields] = await Promise.all([listContacts(business.id, { q, tag, channel }, limit), listTags(business.id), listFields(business.id)]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Contacts" description="Everyone who wrote to you on any channel, with their tags and details. Automations and your team add to them as you go." />
      <ContactsList contacts={list.items} total={list.total} hasMore={list.hasMore} q={q} tag={tag} channel={channel} tags={tags} fields={fields} canManage={can(role, "settings")} />
    </div>
  );
}
