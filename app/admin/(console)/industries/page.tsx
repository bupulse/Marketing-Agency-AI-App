import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Empty, Panel, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { Badge, Button, Input } from "@/components/ui";
import { param } from "@/lib/admin/format";
import { listDismissedSuggestions, listIndustriesAdmin, listIndustrySuggestions } from "@/lib/admin/industries-service";
import { deleteIndustryAction, dismissSuggestionAction, restoreSuggestionAction, setIndustryActiveAction, setIndustryOrderAction } from "./actions";

export const metadata = { title: "Industries" };
export const dynamic = "force-dynamic";

export default async function IndustriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const [industries, suggestions, dismissed] = await Promise.all([listIndustriesAdmin(), listIndustrySuggestions(), listDismissedSuggestions()]);

  return (
    <>
      <PageHeader
        title="Industries"
        description="The business sectors offered at sign-up, with the guidance the AI writes from: customers, offerings, post ideas, tone, hashtags, Rwandan dates and what to avoid. A company's own description is added to this in every prompt. An industry in use is deactivated, never deleted."
        action={<Button href="/admin/industries/new">New industry</Button>}
      />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}

      <Panel title="New from sign-ups" description="What clients typed after choosing “Other”, grouped (trimmed, case-insensitive). Add one as an industry and those companies move to it; dismiss what does not belong.">
        {suggestions.length === 0 ? (
          <Empty>No new industries from sign-ups. Companies that choose “Other” will appear here.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {suggestions.map((s) => (
              <li key={s.key} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {s.label} <span className="text-xs font-medium text-muted">· {s.count} {s.count === 1 ? "company" : "companies"}</span>
                  </p>
                  {s.samples.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-0.5 text-[13px] text-muted">
                      {s.samples.slice(0, 3).map((t) => (
                        <li key={t} className="truncate">“{t}”</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button href={`/admin/industries/new?from=${encodeURIComponent(s.key)}`} size="sm">Add as industry</Button>
                  <ConfirmButton action={dismissSuggestionAction} fields={{ key: s.key }} label="Dismiss" title={`Dismiss “${s.label}”?`} description="It leaves this list; the companies keep what they typed. You can bring it back below." confirmLabel="Dismiss" />
                </div>
              </li>
            ))}
          </ul>
        )}
        {dismissed.length > 0 && (
          <details className="border-t border-line pt-3">
            <summary className="cursor-pointer text-sm font-semibold">Dismissed ({dismissed.length})</summary>
            <ul className="mt-2 flex flex-wrap gap-2">
              {dismissed.map((d) => (
                <li key={d.key}>
                  <form action={restoreSuggestionAction} className="inline-flex items-center gap-2 rounded-full bg-soft px-3 py-1.5 text-[13px]">
                    <input type="hidden" name="key" value={d.key} />
                    <span>{d.label}</span>
                    <button type="submit" className="font-semibold underline">Restore</button>
                  </form>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Panel>

      <Panel title="Industries" description={`${industries.filter((i) => i.active).length} offered at sign-up, ${industries.length} in total. Order: lower first.`}>
        {industries.length === 0 ? (
          <Empty>No industries yet. The migration seeds thirteen; create one above.</Empty>
        ) : (
          <TableWrap caption="Industries">
            <thead>
              <tr><Th>Industry</Th><Th>Short description</Th><Th right>Companies</Th><Th>Order</Th><Th>Status</Th><Th>Actions</Th></tr>
            </thead>
            <tbody>
              {industries.map((i) => (
                <tr key={i.id}>
                  <Td>
                    <Link href={`/admin/industries/${encodeURIComponent(i.id)}`} className="font-semibold underline">{i.name}</Link>
                    <span className="block font-mono text-xs text-muted">{i.slug}</span>
                  </Td>
                  <Td className="max-w-[320px]"><span className="line-clamp-2 text-[13px] text-muted">{i.shortDescription}</span></Td>
                  <Td right>{i.businesses}</Td>
                  <Td>
                    <form action={setIndustryOrderAction} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={i.id} />
                      <Input name="sortOrder" type="number" defaultValue={i.sortOrder} min={-1000} max={1000} aria-label={`Order of ${i.name}`} className="w-20 min-h-10 py-1.5 text-[13px]" />
                      <Button type="submit" size="sm" variant="ghost">Set</Button>
                    </form>
                  </Td>
                  <Td><Badge tone={i.active ? "success" : "neutral"}>{i.active ? "Active" : "Hidden"}</Badge></Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-2">
                      <form action={setIndustryActiveAction}>
                        <input type="hidden" name="id" value={i.id} />
                        <input type="hidden" name="active" value={i.active ? "false" : "true"} />
                        <Button type="submit" size="sm" variant="outline">{i.active ? "Deactivate" : "Activate"}</Button>
                      </form>
                      {i.businesses === 0 && (
                        <ConfirmButton action={deleteIndustryAction} fields={{ id: i.id }} label="Delete" title={`Delete ${i.name}?`} description="No company uses it. This removes it for good (written to the audit log)." confirmLabel="Delete" />
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </>
  );
}
