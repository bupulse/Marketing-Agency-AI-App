import Link from "next/link";
import { dateTime } from "@/lib/admin/format";
import type { ChatLead } from "@/lib/support/admin-leads";
import { Empty, Panel, TableWrap, Td, Th } from "../ui";

/** People who filled in the help chat's form, newest first, with a link to their chat in the support app. */
export function LeadsView({ leads, next, appUrl, first }: { leads: ChatLead[]; next: string | null; appUrl: string; first: boolean }) {
  return (
    <Panel title="Chat leads" description="Visitors who gave their name, email and business in the help chat before asking. Newest first.">
      {leads.length === 0 ? (
        <Empty>{first ? "No chat leads yet. They appear here when a visitor fills in the help chat's form." : "No older chat leads."}</Empty>
      ) : (
        <TableWrap caption="Chat leads">
          <thead><tr><Th>When</Th><Th>Person</Th><Th>Contact</Th><Th>First question</Th><Th /></tr></thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <Td className="whitespace-nowrap">{dateTime(l.createdAt)}</Td>
                <Td className="max-w-[14rem]"><span className="block truncate font-medium">{l.name}</span>{l.businessName && <span className="block truncate text-xs text-muted">{l.businessName}</span>}</Td>
                <Td className="max-w-[16rem]">
                  <a href={`mailto:${l.email}`} className="block truncate underline">{l.email}</a>
                  {l.phone && <a href={`https://wa.me/${l.phone.replace(/[^\d]/g, "")}`} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-muted underline">WhatsApp {l.phone}</a>}
                </Td>
                <Td className="max-w-[22rem]"><span className="line-clamp-2">{l.message}</span></Td>
                <Td right className="whitespace-nowrap">
                  {l.conversationId ? (
                    <a href={`${appUrl}?c=${encodeURIComponent(l.conversationId)}`} target="_blank" rel="noopener" className="font-semibold underline">Open the chat</a>
                  ) : (
                    <span className="text-xs text-muted">No chat found</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      {(next || !first) && (
        <p className="flex gap-4 text-sm">
          {!first && <Link href="/admin/live-chat?tab=leads" className="underline">Newest</Link>}
          {next && <Link href={`/admin/live-chat?tab=leads&after=${encodeURIComponent(next)}`} className="underline">Older</Link>}
        </p>
      )}
    </Panel>
  );
}
