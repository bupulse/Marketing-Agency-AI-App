import Link from "next/link";
import { Clapperboard, Flag, Megaphone, UserRound } from "lucide-react";
import { requirePermission } from "@/lib/admin/auth";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { ChoiceTiles, DataList, EmptyState, FilterChips, PageHeader, StatusPill } from "@/components/admin/kit";
import { MoreLink, Notices, SearchBox } from "@/components/admin/business/shared";
import { Panel, notice } from "@/components/admin/ui";
import { Button, Field, Textarea } from "@/components/ui";
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

function Reason({ required, name = "reason", label, hint = "Saved in the audit log." }: { required?: boolean; name?: string; label?: string; hint?: string }) {
  return (
    <Field label={label ?? (required ? "Reason" : "Reason (optional)")} hint={hint} required={required}>
      <Textarea name={name} rows={2} maxLength={300} required={required} minLength={required ? 3 : undefined} />
    </Field>
  );
}

const BASE = "/admin/creators";

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
      <PageHeader icon={Clapperboard} tone="blue" title="Creator marketplace" description="Campaigns on bupulse.com/creators, creator profiles and the reports people send. Hiding, blocking and resolving are saved in the audit log." />
      <Notices sp={sp} />
      <ChoiceTiles
        label="Marketplace sections"
        param="tab"
        base={BASE}
        current={tab}
        allValue=""
        options={[
          { value: "reports", label: "Reports", hint: "Complaints to look into", icon: Flag, tone: "red" },
          { value: "campaigns", label: "Campaigns", hint: "Every creator campaign", icon: Megaphone, tone: "blue" },
          { value: "creators", label: "Creators", hint: "Every creator profile", icon: UserRound, tone: "violet" },
        ]}
      />
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
        <a href={`/c/${r.campaign.slug}`} target="_blank" rel="noopener noreferrer" className="block max-w-[14rem] truncate font-semibold text-text underline-offset-2 hover:underline">{r.campaign.name}</a>
        <Link href={`/admin/companies/${r.campaign.business.id}`} className="block max-w-[14rem] truncate text-xs font-normal text-muted underline">{r.campaign.business.name}</Link>
        {r.campaign.hiddenAt && <StatusPill tone="bad" dot>Hidden</StatusPill>}
      </>
    );
  }
  if (!r.profile) return <span className="text-muted">Deleted profile</span>;
  return (
    <>
      <Link href={href({ tab: "creators", q: r.profile.name })} className="block max-w-[14rem] truncate font-semibold text-text underline-offset-2 hover:underline">{r.profile.name}</Link>
      <span className="block text-xs font-normal text-muted">Creator</span>
      {r.profile.blockedAt && <StatusPill tone="bad" dot>Blocked</StatusPill>}
    </>
  );
}

async function Reports({ status, cursor, here, base, manage }: { status: string; cursor?: string } & View) {
  const { items, nextCursor } = await listCreatorReports({ status, cursor });
  const open = status === "OPEN";
  return (
    <Panel
      icon={Flag}
      tone="red"
      title={open ? "Open reports" : "Resolved reports"}
      description="Creators report campaigns (a scam, not paying); companies report creators (fake views, spam). Oldest open first. The person reported is never told who reported them."
    >
      <FilterChips label="Report status" param="f" base={BASE} params={{ tab: "reports" }} current={status} allValue="" options={[{ value: "OPEN", label: "Open" }, { value: "RESOLVED", label: "Resolved" }]} />
      <DataList
        caption={open ? "Open reports" : "Resolved reports"}
        rows={items}
        rowKey={(r) => r.id}
        columns={[
          { key: "target", header: "Reported", primary: true, cell: (r) => <ReportTarget r={r} /> },
          {
            key: "reason",
            header: "Reason",
            className: "max-w-[18rem]",
            cell: (r) => (
              <>
                <span className="block font-medium">{REPORT_REASON_LABEL[r.reason as ReportReason] ?? r.reason}</span>
                {r.details && <span className="mt-1 block whitespace-pre-wrap text-xs text-muted">{r.details}</span>}
              </>
            ),
          },
          {
            key: "from",
            header: "From",
            cell: (r) => (
              <span className="block max-w-[14rem]">
                <span className="block truncate">{r.reporterBusiness ?? (r.kind === "CAMPAIGN" ? "A creator" : "A company")}</span>
                <Link href={`/admin/users/${r.reporterUserId}`} className="block truncate text-xs text-muted underline">{r.reporterEmail ?? "Deleted account"}</Link>
              </span>
            ),
          },
          { key: "sent", header: "Sent", cell: (r) => <span className="whitespace-nowrap">{dateTime(r.createdAt)}</span> },
          {
            key: "act",
            header: open ? "Actions" : "Resolution",
            cell: (r) =>
              !open ? (
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
              ),
          },
        ]}
        empty={<EmptyState icon={Clapperboard} tone={open ? "good" : "calm"} title={open ? "No open reports" : "No resolved reports yet"} hint={open ? "Nothing waiting. New reports show here and in the Inbox." : "Resolved reports and their notes show here."} />}
      />
      <MoreLink href={nextCursor ? href({ ...base, f: status, cursor: nextCursor }) : null} />
    </Panel>
  );
}

async function Campaigns({ q, state, cursor, here, base, manage }: { q: string; state: string; cursor?: string } & View) {
  const { items, nextCursor } = await listMarketplaceCampaigns({ q, state, cursor });
  const filtered = Boolean(q || state);
  return (
    <Panel icon={Megaphone} tone="blue" title="Campaigns" description="Every creator campaign. Listed ones show on the marketplace while live and taking applications. Hiding takes one off whatever the company's switch says; its link keeps working.">
      <SearchBox q={q} placeholder="Campaign, link or company" keep={{ tab: "campaigns", f: state }} label="Search campaigns" />
      <FilterChips label="Marketplace state" param="f" base={BASE} params={base} current={state} options={[{ value: "", label: "Any" }, { value: "listed", label: "Listed" }, { value: "unlisted", label: "Not listed (company)" }, { value: "hidden", label: "Hidden (BuPulse)" }]} />
      <DataList
        caption="Creator campaigns"
        rows={items}
        rowKey={(c) => c.id}
        columns={[
          { key: "name", header: "Campaign", primary: true, className: "max-w-[16rem]", cell: (c) => <><a href={`/c/${c.slug}`} target="_blank" rel="noopener noreferrer" className="block truncate font-semibold text-text underline-offset-2 hover:underline">{c.name}</a><span className="block text-xs font-normal text-muted">/c/{c.slug}</span></> },
          { key: "company", header: "Company", cell: (c) => <Link href={`/admin/companies/${c.business.id}`} className="block max-w-[12rem] truncate underline">{c.business.name}</Link> },
          { key: "status", header: "Status", cell: (c) => <StatusPill tone={c.status === "LIVE" ? "good" : "muted"} dot>{CAMPAIGN_STATUS_LABEL[c.status as CampaignStatus] ?? c.status}</StatusPill> },
          { key: "market", header: "Marketplace", cell: (c) => <><StatusPill tone={c.hiddenAt ? "bad" : c.listed ? "good" : "muted"} dot>{c.hiddenAt ? "Hidden" : c.listed ? "Listed" : "Not listed"}</StatusPill>{c.hiddenAt && <span className="mt-1 block max-w-[16rem] text-xs text-muted">{c.hiddenReason} · {dateTime(c.hiddenAt)}</span>}</> },
          { key: "joined", header: "Joined", align: "right", cell: (c) => num(c.joined) },
          { key: "reports", header: "Open reports", align: "right", cell: (c) => (c.openReports > 0 ? <Link href={href({ tab: "reports" })} className="font-semibold text-danger underline">{num(c.openReports)}</Link> : "0") },
          {
            key: "act",
            header: "Actions",
            cell: (c) =>
              !manage ? null : c.hiddenAt ? (
                <ConfirmButton action={unhideCampaignAction} fields={{ id: c.id, back: here }} label="Show again" title={`Show ${c.name} again?`} description="The company's own switch applies again: when it is on, the campaign returns to the marketplace while live." confirmLabel="Show again">
                  <Reason />
                </ConfirmButton>
              ) : (
                <ConfirmButton action={hideCampaignAction} fields={{ id: c.id, back: here }} label="Hide" title={`Hide ${c.name}?`} description="It leaves the marketplace at once, whatever the company's switch says. Its link keeps working for creators already in it. The company sees the reason in the campaign's settings." confirmLabel="Hide">
                  <Reason required hint="Shown to the company and saved in the audit log." />
                </ConfirmButton>
              ),
          },
        ]}
        empty={<EmptyState icon={Clapperboard} title={filtered ? "No campaigns match" : "No creator campaigns yet"} hint={filtered ? "Try a different search or clear the filters." : "Companies' creator campaigns appear here."} action={filtered ? <Button href="/admin/creators?tab=campaigns" variant="outline" size="sm">Clear filters</Button> : undefined} />}
      />
      <MoreLink href={nextCursor ? href({ ...base, cursor: nextCursor }) : null} />
    </Panel>
  );
}

async function Creators({ q, state, cursor, here, base, manage }: { q: string; state: string; cursor?: string } & View) {
  const { items, nextCursor } = await listMarketplaceCreators({ q, state, cursor });
  const filtered = Boolean(q || state);
  return (
    <Panel icon={UserRound} tone="violet" title="Creators" description="Every creator profile. Findable ones chose “Let companies find me”. Blocking stops applying, finding and inviting, and withdraws open invitations; campaigns they joined go on.">
      <SearchBox q={q} placeholder="Name, email, WhatsApp or location" keep={{ tab: "creators", f: state }} label="Search creators" />
      <FilterChips label="Creator state" param="f" base={BASE} params={base} current={state} options={[{ value: "", label: "Any" }, { value: "findable", label: "Findable" }, { value: "blocked", label: "Blocked" }]} />
      <DataList
        caption="Creator profiles"
        rows={items}
        rowKey={(p) => p.id}
        columns={[
          { key: "name", header: "Creator", primary: true, className: "max-w-[16rem]", cell: (p) => <><Link href={`/admin/users/${p.userId}`} className="block truncate font-semibold text-text underline-offset-2 hover:underline">{p.name}</Link><span className="block truncate text-xs font-normal text-muted">{p.email}{p.phone ? ` · ${p.phone}` : ""}</span></> },
          { key: "loc", header: "Location", cell: (p) => <span className="block max-w-[10rem] truncate">{p.location ?? <span className="text-muted">Not given</span>}</span> },
          { key: "state", header: "State", cell: (p) => <><StatusPill tone={p.blockedAt ? "bad" : p.discoverable ? "good" : "muted"} dot>{p.blockedAt ? "Blocked" : p.discoverable ? "Findable" : "Not findable"}</StatusPill>{p.blockedAt && <span className="mt-1 block max-w-[16rem] text-xs text-muted">{p.blockedReason} · {dateTime(p.blockedAt)}</span>}</> },
          { key: "joined", header: "Campaigns joined", align: "right", cell: (p) => num(p.joined) },
          { key: "offers", header: "Open invitations", align: "right", cell: (p) => num(p.openOffers), hideOnPhone: true },
          { key: "reports", header: "Open reports", align: "right", cell: (p) => (p.openReports > 0 ? <Link href={href({ tab: "reports" })} className="font-semibold text-danger underline">{num(p.openReports)}</Link> : "0") },
          {
            key: "act",
            header: "Actions",
            cell: (p) =>
              !manage ? null : p.blockedAt ? (
                <ConfirmButton action={unblockCreatorAction} fields={{ id: p.id, back: here }} label="Unblock" title={`Unblock ${p.name}?`} description="They can apply again, and companies can find and invite them when their profile allows it. Withdrawn invitations stay withdrawn." confirmLabel="Unblock">
                  <Reason />
                </ConfirmButton>
              ) : (
                <ConfirmButton action={blockCreatorAction} fields={{ id: p.id, back: here }} label="Block" title={`Block ${p.name}?`} description={`They can no longer apply, companies cannot find or invite them${p.openOffers ? `, and ${p.openOffers} open ${p.openOffers === 1 ? "invitation is" : "invitations are"} withdrawn` : ""}. Campaigns they joined go on unless a company removes them.`} confirmLabel="Block">
                  <Reason required />
                </ConfirmButton>
              ),
          },
        ]}
        empty={<EmptyState icon={Clapperboard} title={filtered ? "No creators match" : "No creators yet"} hint={filtered ? "Try a different search or clear the filters." : "Creator profiles appear here."} action={filtered ? <Button href="/admin/creators?tab=creators" variant="outline" size="sm">Clear filters</Button> : undefined} />}
      />
      <MoreLink href={nextCursor ? href({ ...base, cursor: nextCursor }) : null} />
    </Panel>
  );
}
