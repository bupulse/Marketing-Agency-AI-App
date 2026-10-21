import Link from "next/link";
import { Clapperboard } from "lucide-react";
import { requirePermission } from "@/lib/admin/auth";
import { EmptyState, PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Panel, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { dateTime, num, param } from "@/lib/admin/format";
import { AdminError } from "@/lib/admin/types";
import { CAMPAIGN_STATUS_LABEL, type CampaignStatus } from "@/lib/creators/company-forms";
import { REPORT_REASON_LABEL, type ReportReason } from "@/lib/creators/report-reasons";
import { listCreatorReports, listMarketplaceCampaigns, listMarketplaceCreators, type CreatorReportRow } from "@/lib/admin/creators-marketplace";
import { blockCreatorAction, hideCampaignAction, resolveReportAction, unblockCreatorAction, unhideCampaignAction } from "./actions";

export const metadata = { title: "Creator marketplace" };

const TABS = [
  ["reports", "Reports"],
  ["campaigns", "Campaigns"],
  ["creators", "Creators"],
] as const;

const href = (params: Record<string, string | undefined>) => `/admin/creators?${new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])))}`;

function PillNav({ label, items, current, make }: { label: string; items: readonly (readonly [string, string])[]; current: string; make: (key: string) => string }) {
  return (
    <nav aria-label={label} className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-soft p-1">
      {items.map(([k, l]) => (
        <Link key={k} href={make(k)} aria-current={current === k ? "page" : undefined} className={cn("inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-medium no-underline", current === k ? "bg-surface text-text shadow-glass" : "text-muted")}>
          {l}
        </Link>
      ))}
    </nav>
  );
}

function Reason({ required, name = "reason", label, hint = "Saved in the audit log." }: { required?: boolean; name?: string; label?: string; hint?: string }) {
  return (
    <Field label={label ?? (required ? "Reason" : "Reason (optional)")} hint={hint} required={required}>
      <Textarea name={name} rows={2} maxLength={300} required={required} minLength={required ? 3 : undefined} />
    </Field>
  );
}

function More({ next }: { next: string | null }) {
  return next ? <Button href={next} variant="outline" className="self-start">Next page</Button> : null;
}

function SearchBar({ tab, q, placeholder, children }: { tab: string; q: string; placeholder: string; children?: React.ReactNode }) {
  return (
    <form className="grid gap-3 sm:grid-cols-[1fr_12rem_auto]" role="search">
      <input type="hidden" name="tab" value={tab} />
      <Input name="q" defaultValue={q} placeholder={placeholder} aria-label="Search" />
      {children}
      <Button type="submit">Search</Button>
    </form>
  );
}

export default async function CreatorMarketplacePage({ searchParams }: PageProps<"/admin/creators">) {
  const me = await requirePermission("clients.view"); // pages render alongside the layout, so check here too
  const manage = me.permissions.includes("clients.manage");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === param(sp.tab)) ? param(sp.tab) : "reports";
  const q = param(sp.q);
  const f = param(sp.f);
  const cursor = param(sp.cursor) || undefined;
  const here = href({ tab, q, f, cursor });
  const base = { tab, q, f };

  let bad: string | null = null;
  let body: React.ReactNode = null;
  try {
    if (tab === "reports") body = await Reports({ status: f || "OPEN", cursor, here, base, manage });
    else if (tab === "campaigns") body = await Campaigns({ q, state: f, cursor, here, base, manage });
    else body = await Creators({ q, state: f, cursor, here, base, manage });
  } catch (e) {
    if (!(e instanceof AdminError)) throw e;
    bad = e.message;
  }

  return (
    <>
      <PageHeader title="Creator marketplace" description="Campaigns on bupulse.com/creators, creator profiles and the reports people send. Hiding, blocking and resolving are saved in the audit log." />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      <PillNav label="Marketplace sections" items={TABS} current={tab} make={(k) => href({ tab: k })} />
      {bad && <p role="alert" className={notice.bad}>{bad}</p>}
      {!bad && body}
    </>
  );
}

type View = { here: string; base: Record<string, string | undefined>; manage: boolean };

function ReportTarget({ r }: { r: CreatorReportRow }) {
  if (r.kind === "CAMPAIGN") {
    if (!r.campaign) return <span className="text-muted">Deleted campaign</span>;
    return (
      <>
        <a href={`/c/${r.campaign.slug}`} target="_blank" rel="noopener noreferrer" className="block max-w-[14rem] truncate font-medium underline">{r.campaign.name}</a>
        <Link href={`/admin/companies/${r.campaign.business.id}`} className="block max-w-[14rem] truncate text-xs text-muted underline">{r.campaign.business.name}</Link>
        {r.campaign.hiddenAt && <Badge tone="danger">Hidden</Badge>}
      </>
    );
  }
  if (!r.profile) return <span className="text-muted">Deleted profile</span>;
  return (
    <>
      <Link href={href({ tab: "creators", q: r.profile.name })} className="block max-w-[14rem] truncate font-medium underline">{r.profile.name}</Link>
      <span className="block text-xs text-muted">Creator</span>
      {r.profile.blockedAt && <Badge tone="danger">Blocked</Badge>}
    </>
  );
}

async function Reports({ status, cursor, here, base, manage }: { status: string; cursor?: string } & View) {
  const { items, nextCursor } = await listCreatorReports({ status, cursor });
  const open = status === "OPEN";
  return (
    <Panel
      title={open ? "Open reports" : "Resolved reports"}
      description="Creators report campaigns (a scam, not paying); companies report creators (fake views, spam). Oldest open first. The person reported is never told who reported them."
      action={<PillNav label="Report status" items={[["OPEN", "Open"], ["RESOLVED", "Resolved"]]} current={status} make={(k) => href({ tab: "reports", f: k })} />}
    >
      {items.length === 0 ? (
        <EmptyState icon={Clapperboard} title={open ? "No open reports" : "No resolved reports yet"} text={open ? "Nothing waiting. New reports show here and in the Inbox." : "Resolved reports and their notes show here."} />
      ) : (
        <TableWrap caption={open ? "Open reports" : "Resolved reports"}>
          <thead><tr><Th>Reported</Th><Th>Reason</Th><Th>From</Th><Th>Sent</Th><Th>{open ? "Actions" : "Resolution"}</Th></tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <Td><ReportTarget r={r} /></Td>
                <Td className="max-w-[18rem]">
                  <span className="block font-medium">{REPORT_REASON_LABEL[r.reason as ReportReason] ?? r.reason}</span>
                  {r.details && <span className="mt-1 block whitespace-pre-wrap text-xs text-muted">{r.details}</span>}
                </Td>
                <Td className="max-w-[14rem]">
                  <span className="block truncate">{r.reporterBusiness ?? (r.kind === "CAMPAIGN" ? "A creator" : "A company")}</span>
                  <Link href={`/admin/users/${r.reporterUserId}`} className="block truncate text-xs text-muted underline">{r.reporterEmail ?? "Deleted account"}</Link>
                </Td>
                <Td className="whitespace-nowrap">{dateTime(r.createdAt)}</Td>
                <Td>
                  {!open ? (
                    <span className="block max-w-[16rem] text-xs">
                      {r.resolution}
                      <span className="block text-muted">{r.resolvedAt ? dateTime(r.resolvedAt) : ""} · {r.resolvedBy}</span>
                    </span>
                  ) : manage ? (
                    <div className="flex flex-wrap gap-2">
                      <ConfirmButton action={resolveReportAction} fields={{ id: r.id, back: here }} label="Resolve" title="Resolve this report?" description="Write what you looked at and what you did. Nothing else changes." confirmLabel="Resolve">
                        <Reason required name="note" label="Note" />
                      </ConfirmButton>
                      {r.kind === "CAMPAIGN" && r.campaign && !r.campaign.hiddenAt && (
                        <ConfirmButton action={hideCampaignAction} fields={{ id: r.campaign.id, reportId: r.id, back: here }} label="Hide campaign" title={`Hide ${r.campaign.name}?`} description="It leaves the marketplace at once, whatever the company's switch says. Its link keeps working for creators already in it. The company sees the reason. The report is resolved with it." confirmLabel="Hide">
                          <Reason required hint="Shown to the company and saved in the audit log." />
                        </ConfirmButton>
                      )}
                      {r.kind === "CREATOR" && r.profile && !r.profile.blockedAt && (
                        <ConfirmButton action={blockCreatorAction} fields={{ id: r.profile.id, reportId: r.id, back: here }} label="Block creator" title={`Block ${r.profile.name}?`} description="They can no longer apply, companies cannot find or invite them, and their open invitations are withdrawn. Campaigns they joined go on. The report is resolved with it." confirmLabel="Block">
                          <Reason required />
                        </ConfirmButton>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted">Needs “Change clients”</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <More next={nextCursor ? href({ ...base, f: status, cursor: nextCursor }) : null} />
    </Panel>
  );
}

async function Campaigns({ q, state, cursor, here, base, manage }: { q: string; state: string; cursor?: string } & View) {
  const { items, nextCursor } = await listMarketplaceCampaigns({ q, state, cursor });
  const filtered = Boolean(q || state);
  return (
    <Panel title="Campaigns" description="Every creator campaign. Listed ones show on the marketplace while live and taking applications. Hiding takes one off whatever the company's switch says; its link keeps working.">
      <SearchBar tab="campaigns" q={q} placeholder="Campaign, link or company">
        <Select name="f" defaultValue={state} aria-label="Marketplace state">
          <option value="">Any</option>
          <option value="listed">Listed</option>
          <option value="unlisted">Not listed (company)</option>
          <option value="hidden">Hidden (BuPulse)</option>
        </Select>
      </SearchBar>
      {items.length === 0 ? (
        <EmptyState icon={Clapperboard} title={filtered ? "No campaigns match" : "No creator campaigns yet"} text={filtered ? "Try a different search or clear the filters." : "Companies' creator campaigns appear here."} action={filtered ? <Button href="/admin/creators?tab=campaigns" variant="outline">Clear filters</Button> : undefined} />
      ) : (
        <TableWrap caption="Creator campaigns">
          <thead><tr><Th>Campaign</Th><Th>Company</Th><Th>Status</Th><Th>Marketplace</Th><Th right>Joined</Th><Th right>Open reports</Th><Th>Actions</Th></tr></thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <Td className="max-w-[16rem]">
                  <a href={`/c/${c.slug}`} target="_blank" rel="noopener noreferrer" className="block truncate font-medium underline">{c.name}</a>
                  <span className="block text-xs text-muted">/c/{c.slug}</span>
                </Td>
                <Td><Link href={`/admin/companies/${c.business.id}`} className="block max-w-[12rem] truncate underline">{c.business.name}</Link></Td>
                <Td><Badge tone={c.status === "LIVE" ? "success" : "neutral"}>{CAMPAIGN_STATUS_LABEL[c.status as CampaignStatus] ?? c.status}</Badge></Td>
                <Td className="max-w-[16rem]">
                  <Badge tone={c.hiddenAt ? "danger" : c.listed ? "success" : "neutral"}>{c.hiddenAt ? "Hidden" : c.listed ? "Listed" : "Not listed"}</Badge>
                  {c.hiddenAt && <span className="mt-1 block text-xs text-muted">{c.hiddenReason} · {dateTime(c.hiddenAt)}</span>}
                </Td>
                <Td right>{num(c.joined)}</Td>
                <Td right>{c.openReports > 0 ? <Link href={href({ tab: "reports" })} className="font-semibold text-danger underline">{num(c.openReports)}</Link> : "0"}</Td>
                <Td>
                  {!manage ? null : c.hiddenAt ? (
                    <ConfirmButton action={unhideCampaignAction} fields={{ id: c.id, back: here }} label="Show again" title={`Show ${c.name} again?`} description="The company's own switch applies again: when it is on, the campaign returns to the marketplace while live." confirmLabel="Show again">
                      <Reason />
                    </ConfirmButton>
                  ) : (
                    <ConfirmButton action={hideCampaignAction} fields={{ id: c.id, back: here }} label="Hide" title={`Hide ${c.name}?`} description="It leaves the marketplace at once, whatever the company's switch says. Its link keeps working for creators already in it. The company sees the reason in the campaign's settings." confirmLabel="Hide">
                      <Reason required hint="Shown to the company and saved in the audit log." />
                    </ConfirmButton>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <More next={nextCursor ? href({ ...base, cursor: nextCursor }) : null} />
    </Panel>
  );
}

async function Creators({ q, state, cursor, here, base, manage }: { q: string; state: string; cursor?: string } & View) {
  const { items, nextCursor } = await listMarketplaceCreators({ q, state, cursor });
  const filtered = Boolean(q || state);
  return (
    <Panel title="Creators" description="Every creator profile. Findable ones chose “Let companies find me”. Blocking stops applying, finding and inviting, and withdraws open invitations; campaigns they joined go on.">
      <SearchBar tab="creators" q={q} placeholder="Name, email, WhatsApp or location">
        <Select name="f" defaultValue={state} aria-label="Creator state">
          <option value="">Any</option>
          <option value="findable">Findable</option>
          <option value="blocked">Blocked</option>
        </Select>
      </SearchBar>
      {items.length === 0 ? (
        <EmptyState icon={Clapperboard} title={filtered ? "No creators match" : "No creators yet"} text={filtered ? "Try a different search or clear the filters." : "Creator profiles appear here."} action={filtered ? <Button href="/admin/creators?tab=creators" variant="outline">Clear filters</Button> : undefined} />
      ) : (
        <TableWrap caption="Creator profiles">
          <thead><tr><Th>Creator</Th><Th>Location</Th><Th>State</Th><Th right>Campaigns joined</Th><Th right>Open invitations</Th><Th right>Open reports</Th><Th>Actions</Th></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <Td className="max-w-[16rem]">
                  <Link href={`/admin/users/${p.userId}`} className="block truncate font-medium underline">{p.name}</Link>
                  <span className="block truncate text-xs text-muted">{p.email}{p.phone ? ` · ${p.phone}` : ""}</span>
                </Td>
                <Td className="max-w-[10rem] truncate">{p.location ?? <span className="text-muted">Not given</span>}</Td>
                <Td className="max-w-[16rem]">
                  <Badge tone={p.blockedAt ? "danger" : p.discoverable ? "success" : "neutral"}>{p.blockedAt ? "Blocked" : p.discoverable ? "Findable" : "Not findable"}</Badge>
                  {p.blockedAt && <span className="mt-1 block text-xs text-muted">{p.blockedReason} · {dateTime(p.blockedAt)}</span>}
                </Td>
                <Td right>{num(p.joined)}</Td>
                <Td right>{num(p.openOffers)}</Td>
                <Td right>{p.openReports > 0 ? <Link href={href({ tab: "reports" })} className="font-semibold text-danger underline">{num(p.openReports)}</Link> : "0"}</Td>
                <Td>
                  {!manage ? null : p.blockedAt ? (
                    <ConfirmButton action={unblockCreatorAction} fields={{ id: p.id, back: here }} label="Unblock" title={`Unblock ${p.name}?`} description="They can apply again, and companies can find and invite them when their profile allows it. Withdrawn invitations stay withdrawn." confirmLabel="Unblock">
                      <Reason />
                    </ConfirmButton>
                  ) : (
                    <ConfirmButton action={blockCreatorAction} fields={{ id: p.id, back: here }} label="Block" title={`Block ${p.name}?`} description={`They can no longer apply, companies cannot find or invite them${p.openOffers ? `, and ${p.openOffers} open ${p.openOffers === 1 ? "invitation is" : "invitations are"} withdrawn` : ""}. Campaigns they joined go on unless a company removes them.`} confirmLabel="Block">
                      <Reason required />
                    </ConfirmButton>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <More next={nextCursor ? href({ ...base, cursor: nextCursor }) : null} />
    </Panel>
  );
}
