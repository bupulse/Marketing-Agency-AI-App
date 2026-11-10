import Link from "next/link";
import { UserPlus } from "lucide-react";
import { buttonClasses } from "@/components/ui";
import { dateTime } from "@/lib/admin/format";
import type { ChatLead } from "@/lib/support/admin-leads";
import { DataList, EmptyState } from "../kit";

/** People who filled in the help chat's form, newest first, with a link to their chat in the support app. */
export function LeadsView({ leads, next, appUrl, first }: { leads: ChatLead[]; next: string | null; appUrl: string; first: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <DataList<ChatLead>
        caption="Chat leads"
        rows={leads}
        rowKey={(l) => l.id}
        columns={[
          { key: "person", header: "Person", primary: true, cell: (l) => <span className="flex min-w-0 flex-col"><span className="truncate">{l.name}</span>{l.businessName && <span className="truncate text-xs font-normal text-muted">{l.businessName}</span>}</span> },
          {
            key: "contact",
            header: "Contact",
            cell: (l) => (
              <span className="flex min-w-0 flex-col">
                <a href={`mailto:${l.email}`} className="truncate underline">{l.email}</a>
                {l.phone && <a href={`https://wa.me/${l.phone.replace(/[^\d]/g, "")}`} target="_blank" rel="noopener noreferrer" className="truncate text-xs text-muted underline">WhatsApp {l.phone}</a>}
              </span>
            ),
          },
          { key: "question", header: "First question", className: "max-w-[22rem]", cell: (l) => <span className="line-clamp-2">{l.message}</span> },
          { key: "when", header: "When", cell: (l) => <span className="whitespace-nowrap">{dateTime(l.createdAt)}</span> },
          {
            key: "chat",
            header: <span className="sr-only">Chat</span>,
            align: "right",
            cell: (l) => (l.conversationId ? <a href={`${appUrl}?c=${encodeURIComponent(l.conversationId)}`} target="_blank" rel="noopener" className="whitespace-nowrap font-semibold underline">Open the chat</a> : <span className="text-xs text-muted">No chat found</span>),
          },
        ]}
        empty={<EmptyState icon={UserPlus} title={first ? "No chat leads yet." : "No older chat leads."} hint={first ? "They appear here when a visitor fills in the help chat's form." : undefined} />}
      />
      {(next || !first) && (
        <p className="flex gap-2">
          {!first && <Link href="/admin/live-chat?tab=leads" className={buttonClasses({ variant: "outline", size: "sm" })}>Newest</Link>}
          {next && <Link href={`/admin/live-chat?tab=leads&after=${encodeURIComponent(next)}`} className={buttonClasses({ variant: "outline", size: "sm" })}>Older</Link>}
        </p>
      )}
    </div>
  );
}
