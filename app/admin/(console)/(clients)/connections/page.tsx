import Link from "next/link";
import { Cloud, FolderOpen, KeyRound, MessageSquareText, Palette, Plug, ShoppingBag, Webhook } from "lucide-react";
import { requirePermission } from "@/lib/admin/auth";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { notice } from "@/components/admin/ui";
import { CARD, DataList, EmptyState, FilterChips, IconBadge, PageHeader, StatusPill, type KitTone, type PillTone } from "@/components/admin/kit";
import { ConnectionsHub, NETWORK_NAME } from "@/components/admin/business/connections-hub";
import { MoreLink, Notices, SearchBox } from "@/components/admin/business/shared";
import { Button, Field, Textarea } from "@/components/ui";
import { dateTime, num, param } from "@/lib/admin/format";
import { AdminError } from "@/lib/admin/types";
import {
  CHANNEL_STATUSES,
  listApiKeys,
  listCanvaConnections,
  listChannels,
  listCloudflareConnections,
  listFileImportUsage,
  listStoreConnections,
  listWebhookEndpoints,
  listWidgets,
  type ChannelStatus,
} from "@/lib/admin/connections";
import {
  disconnectConnectorAction,
  forceDisconnectAction,
  pauseWebhookAction,
  resumeWebhookAction,
  revokeApiKeyAction,
  switchOffWidgetAction,
  switchOnWidgetAction,
} from "./actions";

export const metadata = { title: "Connections" };

const TABS = [
  ["channels", "Social channels"],
  ["connectors", "Connectors"],
  ["webhooks", "Webhooks and API keys"],
  ["widgets", "Website chat"],
] as const;
const KINDS = [
  ["store", "Stores"],
  ["cloudflare", "Cloudflare"],
  ["canva", "Canva"],
  ["files", "Drive and Dropbox"],
] as const;
const TAB_ICON = { channels: Plug, connectors: ShoppingBag, webhooks: Webhook, widgets: MessageSquareText } as const;
const KIND_ICON = { store: ShoppingBag, cloudflare: Cloud, canva: Palette, files: FolderOpen } as const;
const STATUS_UI: Record<ChannelStatus, { label: string; tone: PillTone }> = {
  healthy: { label: "Healthy", tone: "good" },
  expiring: { label: "Login expiring", tone: "warn" },
  expired: { label: "Expired", tone: "bad" },
  needs_reconnect: { label: "Needs reconnect", tone: "bad" },
};

const BASE = "/admin/connections";
const href = (params: Record<string, string | undefined>) => `${BASE}?${new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])))}`;
const when = (d: Date | null) => (d ? dateTime(d) : "Never");

function Client({ b }: { b: { name: string; ownerEmail: string; userId: string } }) {
  return (
    <>
      <Link href={`/admin/users/${b.userId}`} className="block max-w-[14rem] truncate font-semibold text-text underline-offset-2 hover:underline">{b.name}</Link>
      <span className="block max-w-[14rem] truncate text-xs font-normal text-muted">{b.ownerEmail}</span>
    </>
  );
}

function Reason({ required, hint }: { required?: boolean; hint?: string }) {
  return (
    <Field label={required ? "Reason" : "Reason (optional)"} hint={hint ?? "Saved in the audit log."} required={required}>
      <Textarea name="reason" rows={2} maxLength={300} required={required} />
    </Field>
  );
}

/** A titled card for one list (the old Panel), with the area's tone. */
function ListCard({ icon, tone = "blue", title, description, children }: { icon: Parameters<typeof IconBadge>[0]["icon"]; tone?: KitTone; title: string; description: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className={`flex min-w-0 flex-col gap-4 p-4 sm:p-6 ${CARD}`}>
      <div className="flex items-start gap-3">
        <IconBadge icon={icon} tone={tone} />
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold leading-snug tracking-[-0.02em]">{title}</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-muted">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export default async function ConnectionsPage({ searchParams }: PageProps<"/admin/connections">) {
  await requirePermission("clients.view"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const asked = param(sp.tab);
  const q = param(sp.q);
  // No area picked (and no search): the landing page of cards. A search without an area looks in social channels.
  if (!TABS.some(([k]) => k === asked) && !q) {
    return (
      <>
        <Notices sp={sp} />
        <ConnectionsHub />
      </>
    );
  }
  const tab = TABS.some(([k]) => k === asked) ? asked : "channels";
  const kind = KINDS.some(([k]) => k === param(sp.kind)) ? param(sp.kind) : "store";
  const f1 = param(sp.f1);
  const f2 = param(sp.f2);
  const cursor = param(sp.cursor) || undefined;
  const kcursor = param(sp.kcursor) || undefined;
  const here = href({ tab, kind: tab === "connectors" ? kind : undefined, q, f1, f2, cursor, kcursor });
  const base = { tab, kind: tab === "connectors" ? kind : undefined, q, f1, f2 };

  let bad: string | null = null;
  let body: React.ReactNode = null;
  try {
    if (tab === "channels") body = await Channels({ q, network: f1, status: f2, cursor, here, base });
    else if (tab === "connectors") body = await Connectors({ kind, q, f1, f2, cursor, here, base });
    else if (tab === "webhooks") body = await Webhooks({ q, state: f1, cursor, kcursor, here, base });
    else body = await Widgets({ q, state: f1, cursor, here, base });
  } catch (e) {
    if (!(e instanceof AdminError)) throw e;
    bad = e.message;
  }

  return (
    <>
      <PageHeader icon={TAB_ICON[tab as keyof typeof TAB_ICON]} tone="blue" title={TABS.find(([k]) => k === tab)![1]} description="Actions here are saved in the audit log." back={{ href: BASE, label: "All connections" }} />
      <Notices sp={sp} />
      <FilterChips label="Connection types" param="tab" base={BASE} current={tab} allValue="" options={TABS.map(([k, l]) => ({ value: k, label: l, icon: TAB_ICON[k] }))} />
      {bad && <p role="alert" className={notice.bad}>{bad}</p>}
      {!bad && body}
    </>
  );
}

type View = { here: string; base: Record<string, string | undefined> };

function Search({ q, base, placeholder = "Business name or email" }: { q: string; base: Record<string, string | undefined>; placeholder?: string }) {
  const { q: _q, ...keep } = base; // eslint-disable-line @typescript-eslint/no-unused-vars
  return <SearchBox q={q} placeholder={placeholder} keep={keep} label="Search connections" />;
}

function Empty2({ title = "Nothing here", hint = "No connections match. Try a different search or clear the filters.", clear }: { title?: string; hint?: string; clear?: string }) {
  return <EmptyState icon={Plug} title={title} hint={hint} action={clear ? <Button href={clear} variant="outline" size="sm">Clear filters</Button> : undefined} />;
}

async function Channels({ q, network, status, cursor, here, base }: { q: string; network: string; status: string; cursor?: string } & View) {
  const { items, nextCursor } = await listChannels({ q, network, status, cursor });
  const filtered = Boolean(q || network || status);
  return (
    <ListCard icon={Plug} title={network ? `${NETWORK_NAME[network] ?? network} accounts` : "Social channels"} description="Instagram, Facebook, LinkedIn, TikTok and YouTube accounts. Force disconnect erases the saved login but keeps the account and its posts.">
      <Search q={q} base={base} />
      <FilterChips label="Network" param="f1" base={BASE} params={base} current={network} options={[{ value: "", label: "Any network" }, ...Object.entries(NETWORK_NAME).map(([k, v]) => ({ value: k, label: v }))]} />
      <FilterChips label="Status" param="f2" base={BASE} params={base} current={status} options={[{ value: "", label: "Any status" }, ...CHANNEL_STATUSES.map((s) => ({ value: s, label: STATUS_UI[s].label }))]} />
      <DataList
        caption="Social channels"
        rows={items}
        rowKey={(c) => c.id}
        columns={[
          { key: "acc", header: "Account", primary: true, className: "max-w-[14rem]", cell: (c) => <><span className="block truncate">{c.accountName}</span><span className="block text-xs font-normal text-muted">{NETWORK_NAME[c.network] ?? c.network} · {c.accountType ?? "account"}{c.postingMode === "NOTIFY" ? " · reminders" : ""}</span></> },
          { key: "client", header: "Client", cell: (c) => <Client b={c.business} /> },
          { key: "status", header: "Status", cell: (c) => <><StatusPill tone={STATUS_UI[c.status].tone} dot>{STATUS_UI[c.status].label}</StatusPill>{c.lastError && <span className="mt-1 block max-w-[14rem] text-xs text-muted">{c.lastError}</span>}</> },
          { key: "exp", header: "Login expires", cell: (c) => <span className="whitespace-nowrap">{c.expiresAt ? dateTime(c.expiresAt) : <span className="text-muted">None</span>}</span>, hideOnPhone: true },
          { key: "ok", header: "Last post OK", cell: (c) => <span className="whitespace-nowrap">{when(c.lastPublishOkAt)}</span>, hideOnPhone: true },
          { key: "fail", header: "Failed, 7 days", align: "right", cell: (c) => (c.failedPosts7d > 0 ? <span className="font-semibold text-danger">{num(c.failedPosts7d)}</span> : "0") },
          {
            key: "act",
            header: "Actions",
            cell: (c) =>
              c.rawStatus === "REVOKED" && c.status === "needs_reconnect" && c.lastError?.startsWith("Disconnected by") ? (
                <span className="text-xs text-muted">Disconnected{c.queuedPosts ? `, ${c.queuedPosts} queued` : ""}</span>
              ) : (
                <ConfirmButton
                  action={forceDisconnectAction}
                  fields={{ id: c.id, back: here }}
                  label="Force disconnect"
                  title={`Force disconnect ${c.accountName}?`}
                  description={`This erases the saved login for this ${NETWORK_NAME[c.network] ?? c.network} account. ${c.queuedPosts ? `${c.queuedPosts} queued post${c.queuedPosts === 1 ? "" : "s"} will stay and be marked as needing a reconnect.` : "No posts are deleted."} The owner can reconnect it any time.`}
                  confirmLabel="Disconnect"
                >
                  <Reason />
                </ConfirmButton>
              ),
          },
        ]}
        empty={<Empty2 title={filtered ? "No channels match" : "No channels yet"} hint={filtered ? "Try a different search or clear the filters." : "Connected accounts appear here."} clear={filtered ? `${BASE}?tab=channels` : undefined} />}
      />
      <MoreLink href={nextCursor ? href({ ...base, cursor: nextCursor }) : null} />
    </ListCard>
  );
}

async function Connectors({ kind, q, f1, f2, cursor, here, base }: { kind: string; q: string; f1: string; f2: string; cursor?: string } & View) {
  const nav = <FilterChips label="Connector type" param="kind" base={BASE} params={{ tab: "connectors" }} current={kind} allValue="" options={KINDS.map(([k, l]) => ({ value: k, label: l, icon: KIND_ICON[k] }))} />;
  const clear = `${BASE}?tab=connectors&kind=${kind}`;
  const statusChips = <FilterChips label="Status" param="f2" base={BASE} params={base} current={f2} options={[{ value: "", label: "Any status" }, { value: "ACTIVE", label: "Active" }, { value: "NEEDS_ATTENTION", label: "Needs attention" }]} />;
  const disconnect = (k: string, id: string, what: string) => <DisconnectButton kind={k} id={id} here={here} what={what} />;
  const active = (s: string) => <StatusPill tone={s === "ACTIVE" ? "good" : "bad"} dot>{s === "ACTIVE" ? "Active" : "Needs attention"}</StatusPill>;
  if (kind === "store") {
    const { items, nextCursor } = await listStoreConnections({ q, provider: f1, status: f2, cursor });
    return (
      <>
        {nav}
        <ListCard icon={ShoppingBag} tone="green" title="Stores" description="Shopify and WooCommerce stores. Disconnecting removes the saved keys; imported products stay.">
          <Search q={q} base={base} />
          <FilterChips label="Store type" param="f1" base={BASE} params={base} current={f1} options={[{ value: "", label: "Any store type" }, { value: "shopify", label: "Shopify" }, { value: "woocommerce", label: "WooCommerce" }]} />
          {statusChips}
          <DataList
            caption="Store connections"
            rows={items}
            rowKey={(s) => s.id}
            columns={[
              { key: "store", header: "Store", primary: true, className: "max-w-[14rem]", cell: (s) => <><span className="block truncate">{s.store}</span><span className="text-xs font-normal text-muted">{s.provider === "shopify" ? "Shopify" : "WooCommerce"}</span></> },
              { key: "client", header: "Client", cell: (s) => <Client b={s.business} /> },
              { key: "status", header: "Status", cell: (s) => active(s.status) },
              { key: "sync", header: "Last sync", cell: (s) => <span className="whitespace-nowrap">{when(s.lastSyncAt)}</span>, hideOnPhone: true },
              { key: "products", header: "Products", align: "right", cell: (s) => num(s.products) },
              { key: "err", header: "Last error", cell: (s) => <span className="block max-w-[16rem] text-xs text-muted">{s.lastError ?? ""}</span>, hideOnPhone: true },
              { key: "act", header: "Actions", cell: (s) => disconnect("store", s.id, s.store) },
            ]}
            empty={<Empty2 clear={clear} />}
          />
          <MoreLink href={nextCursor ? href({ ...base, cursor: nextCursor }) : null} />
        </ListCard>
      </>
    );
  }
  if (kind === "cloudflare") {
    const { items, nextCursor } = await listCloudflareConnections({ q, status: f2, cursor });
    return (
      <>
        {nav}
        <ListCard icon={Cloud} tone="orange" title="Cloudflare" description="Cloudflare tokens and the chat-widget installs made with them.">
          <Search q={q} base={base} />
          {statusChips}
          <DataList
            caption="Cloudflare connections"
            rows={items}
            rowKey={(c) => c.id}
            columns={[
              { key: "client", header: "Client", primary: true, cell: (c) => <Client b={c.business} /> },
              { key: "status", header: "Status", cell: (c) => active(c.status) },
              { key: "installs", header: "Installs", align: "right", cell: (c) => num(c.installCount) },
              { key: "zones", header: "Domains", cell: (c) => <span className="block max-w-[16rem] truncate text-xs">{c.zones.join(", ") || <span className="text-muted">None</span>}</span> },
              { key: "at", header: "Connected", cell: (c) => <span className="whitespace-nowrap">{dateTime(c.connectedAt)}</span>, hideOnPhone: true },
              { key: "act", header: "Actions", cell: (c) => disconnect("cloudflare", c.id, "Cloudflare") },
            ]}
            empty={<Empty2 clear={clear} />}
          />
          <MoreLink href={nextCursor ? href({ ...base, cursor: nextCursor }) : null} />
        </ListCard>
      </>
    );
  }
  if (kind === "canva") {
    const { items, nextCursor } = await listCanvaConnections({ q, cursor });
    return (
      <>
        {nav}
        <ListCard icon={Palette} tone="violet" title="Canva" description="Linked Canva accounts. The short-lived login refreshes itself when the owner uses Canva.">
          <Search q={q} base={base} />
          <DataList
            caption="Canva connections"
            rows={items}
            rowKey={(c) => c.id}
            columns={[
              { key: "client", header: "Client", primary: true, cell: (c) => <Client b={c.business} /> },
              { key: "status", header: "Status", cell: () => <StatusPill tone="good" dot>Connected</StatusPill> },
              { key: "exp", header: "Login expiry", cell: (c) => <span className="whitespace-nowrap">{dateTime(c.tokenExpiresAt)}{c.tokenExpired && <span className="block text-xs text-muted">Refreshes on next use</span>}</span> },
              { key: "imports", header: "Imports", align: "right", cell: (c) => num(c.imports) },
              { key: "at", header: "Connected", cell: (c) => <span className="whitespace-nowrap">{dateTime(c.connectedAt)}</span>, hideOnPhone: true },
              { key: "act", header: "Actions", cell: (c) => disconnect("canva", c.id, "Canva") },
            ]}
            empty={<Empty2 clear={clear} />}
          />
          <MoreLink href={nextCursor ? href({ ...base, cursor: nextCursor }) : null} />
        </ListCard>
      </>
    );
  }
  const { items, nextCursor } = await listFileImportUsage({ q, cursor });
  return (
    <>
      {nav}
      <ListCard icon={FolderOpen} tone="slate" title="Drive and Dropbox" description="Google Drive and Dropbox use the file picker and keep no login, so there is nothing to disconnect. This is how many files each client imported.">
        <Search q={q} base={base} />
        <DataList
          caption="Drive and Dropbox imports"
          rows={items}
          rowKey={(b) => b.id}
          columns={[
            { key: "client", header: "Client", primary: true, cell: (b) => <Client b={b.business} /> },
            { key: "drive", header: "Drive files", align: "right", cell: (b) => num(b.googleDrive.files) },
            { key: "driveAt", header: "Last Drive import", cell: (b) => <span className="whitespace-nowrap">{when(b.googleDrive.lastAt)}</span> },
            { key: "dropbox", header: "Dropbox files", align: "right", cell: (b) => num(b.dropbox.files) },
            { key: "dropboxAt", header: "Last Dropbox import", cell: (b) => <span className="whitespace-nowrap">{when(b.dropbox.lastAt)}</span> },
          ]}
          empty={<Empty2 clear={clear} />}
        />
        <MoreLink href={nextCursor ? href({ ...base, cursor: nextCursor }) : null} />
      </ListCard>
    </>
  );
}

function DisconnectButton({ kind, id, here, what }: { kind: string; id: string; here: string; what: string }) {
  return (
    <ConfirmButton
      action={disconnectConnectorAction}
      fields={{ kind, id, back: here }}
      label="Disconnect"
      title={`Disconnect ${what}?`}
      description="This removes the saved login or keys. Imported products and files stay. The owner can connect again."
      confirmLabel="Disconnect"
    >
      <Reason />
    </ConfirmButton>
  );
}

async function Webhooks({ q, state, cursor, kcursor, here, base }: { q: string; state: string; cursor?: string; kcursor?: string } & View) {
  const [hooks, keys] = await Promise.all([listWebhookEndpoints({ q, state, cursor }), listApiKeys({ q, cursor: kcursor })]);
  return (
    <>
      <ListCard icon={Webhook} tone="indigo" title="Webhooks" description="Where clients' events are sent. Only the web address's host is shown, never the full address or the signing secret.">
        <Search q={q} base={base} />
        <FilterChips label="State" param="f1" base={BASE} params={base} current={state} options={[{ value: "", label: "Any state" }, { value: "active", label: "Running" }, { value: "paused", label: "Paused or off" }, { value: "failing", label: "Failing" }]} />
        <DataList
          caption="Webhook endpoints"
          rows={hooks.items}
          rowKey={(h) => h.id}
          columns={[
            { key: "host", header: "Endpoint", primary: true, className: "max-w-[14rem]", cell: (h) => <><span className="block truncate">{h.host}</span><StatusPill tone={h.pausedBySupport ? "bad" : h.enabled ? "good" : "muted"} dot>{h.pausedBySupport ? "Paused (support)" : h.enabled ? "Running" : "Off (owner)"}</StatusPill>{h.pauseReason && <span className="mt-1 block text-xs font-normal text-muted">{h.pauseReason}</span>}</> },
            { key: "client", header: "Client", cell: (h) => <Client b={h.business} /> },
            { key: "events", header: "Events", cell: (h) => <span className="block max-w-[12rem] text-xs">{h.events.join(", ")}</span>, hideOnPhone: true },
            { key: "ok", header: "Success, 7 days", align: "right", cell: (h) => (h.successRate7d == null ? <span className="text-muted">No deliveries</span> : `${h.successRate7d}% of ${num(h.deliveries7d)}`) },
            { key: "streak", header: "Failure streak", align: "right", cell: (h) => (h.failureStreak > 0 ? <span className="font-semibold text-danger">{h.failureStreak}</span> : "0") },
            { key: "err", header: "Last error", cell: (h) => <span className="block max-w-[14rem] text-xs text-muted">{h.lastError ?? ""}</span>, hideOnPhone: true },
            {
              key: "act",
              header: "Actions",
              cell: (h) =>
                h.pausedBySupport ? (
                  <ConfirmButton action={resumeWebhookAction} fields={{ id: h.id, back: here }} label="Resume" title={`Resume ${h.host}?`} description="Events are sent again and the failure streak starts from zero." confirmLabel="Resume">
                    <Reason />
                  </ConfirmButton>
                ) : h.enabled ? (
                  <ConfirmButton action={pauseWebhookAction} fields={{ id: h.id, back: here }} label="Pause" title={`Pause ${h.host}?`} description="No more events are sent to this endpoint until you resume it, and the owner cannot turn it back on. Events in between are not replayed." confirmLabel="Pause">
                    <Reason required hint="Saved in the audit log." />
                  </ConfirmButton>
                ) : (
                  <span className="text-xs text-muted">Switched off by the owner</span>
                ),
            },
          ]}
          empty={<Empty2 title="No webhooks" hint="No webhook endpoints match." />}
        />
        <MoreLink href={hooks.nextCursor ? href({ ...base, cursor: hooks.nextCursor, kcursor }) : null} />
      </ListCard>
      <ListCard icon={KeyRound} tone="indigo" title="API keys" description="Pro plan keys. Only the first characters of a key are stored in readable form; the key itself is never available. Calls are counted over the last two days.">
        <DataList
          caption="Client API keys"
          rows={keys.items}
          rowKey={(k) => k.id}
          columns={[
            { key: "key", header: "Key", primary: true, className: "max-w-[14rem]", cell: (k) => <><span className="block truncate">{k.name}</span><code className="text-xs font-normal text-muted">{k.prefix}…</code></> },
            { key: "client", header: "Client", cell: (k) => <Client b={k.business} /> },
            { key: "scopes", header: "Scopes", cell: (k) => <span className="block max-w-[14rem] text-xs">{k.scopes.join(", ")}</span>, hideOnPhone: true },
            { key: "used", header: "Last used", cell: (k) => <span className="whitespace-nowrap">{when(k.lastUsedAt)}</span> },
            { key: "calls", header: "Calls, 2 days", align: "right", cell: (k) => num(k.calls2d) },
            {
              key: "act",
              header: "Actions",
              cell: (k) => (
                <ConfirmButton action={revokeApiKeyAction} fields={{ id: k.id, back: here }} label="Revoke" title={`Revoke ${k.name}?`} description="The key stops working at once. The owner can make a new one." confirmLabel="Revoke">
                  <Reason />
                </ConfirmButton>
              ),
            },
          ]}
          empty={<Empty2 title="No API keys" hint="No active client API keys match." />}
        />
        <MoreLink href={keys.nextCursor ? href({ ...base, cursor, kcursor: keys.nextCursor }) : null} />
      </ListCard>
    </>
  );
}

const SIGNAL: Record<string, { label: string; tone: PillTone }> = { ok: { label: "Normal", tone: "good" }, watch: { label: "Watch", tone: "warn" }, high: { label: "High", tone: "bad" } };

async function Widgets({ q, state, cursor, here, base }: { q: string; state: string; cursor?: string } & View) {
  const { items, nextCursor } = await listWidgets({ q, state, cursor });
  return (
    <ListCard icon={MessageSquareText} tone="teal" title="Website chat widgets" description="Chats and leads are counted per visitor conversation. The abuse signal looks at traffic spikes, refused requests (rate limits) and visits from sites that are not on the allowed list.">
      <Search q={q} base={base} />
      <FilterChips label="State" param="f1" base={BASE} params={base} current={state} options={[{ value: "", label: "Any state" }, { value: "on", label: "On" }, { value: "off", label: "Off (owner)" }, { value: "support_off", label: "Off (support)" }]} />
      <DataList
        caption="Website chat widgets"
        rows={items}
        rowKey={(w) => w.id}
        columns={[
          { key: "client", header: "Client", primary: true, cell: (w) => <><Client b={w.business} /><StatusPill tone={w.switchedOffBySupport ? "bad" : w.enabled ? "good" : "muted"} dot>{w.switchedOffBySupport ? "Off (support)" : w.enabled ? "On" : "Off (owner)"}</StatusPill></> },
          { key: "sites", header: "Sites", cell: (w) => <span className="block max-w-[14rem] text-xs">{w.openToAnySite ? <span className="font-semibold text-danger">Any site allowed</span> : w.allowedDomains.join(", ")}</span> },
          { key: "seen", header: "Last seen", cell: (w) => <span className="whitespace-nowrap">{w.lastSeenAt ? <>{dateTime(w.lastSeenAt)}<span className="block max-w-[12rem] truncate text-xs text-muted">{w.lastSeenHost}</span></> : <span className="text-muted">Never</span>}</span>, hideOnPhone: true },
          { key: "chats", header: "Chats 7d / 30d", align: "right", cell: (w) => `${num(w.chats7d)} / ${num(w.chats30d)}` },
          { key: "leads", header: "Leads 7d / 30d", align: "right", cell: (w) => `${num(w.leads7d)} / ${num(w.leads30d)}` },
          { key: "credits", header: "Replies used", align: "right", cell: (w) => <span className={w.credits.limit > 0 && w.credits.used >= w.credits.limit ? "font-semibold text-danger" : undefined}>{num(w.credits.used)} of {num(w.credits.limit)}</span> },
          {
            key: "signal",
            header: "Abuse signal",
            cell: (w) => (
              <>
                <StatusPill tone={SIGNAL[w.signal].tone} dot>{SIGNAL[w.signal].label}</StatusPill>
                <span className="mt-1 block max-w-[14rem] text-xs text-muted">{[w.spike && "traffic spike", w.refusedRequests > 0 && `${num(w.refusedRequests)} requests refused`, w.hostMismatch && "seen on a site not on the list"].filter(Boolean).join(", ")}</span>
              </>
            ),
          },
          {
            key: "act",
            header: "Actions",
            cell: (w) =>
              w.switchedOffBySupport ? (
                <ConfirmButton action={switchOnWidgetAction} fields={{ id: w.id, back: here }} label="Switch on" title={`Switch on the chat for ${w.business.name}?`} description={`It was switched off${w.switchOffReason ? `: ${w.switchOffReason}` : ""}. The owner's own on/off setting applies again.`} confirmLabel="Switch on" />
              ) : (
                <ConfirmButton action={switchOffWidgetAction} fields={{ id: w.id, back: here }} label="Switch off" title={`Switch off the chat for ${w.business.name}?`} description="The chat stops answering visitors at once. The owner sees it as switched off, with a Contact support link, and cannot turn it back on." confirmLabel="Switch off">
                  <Reason required hint="Saved in the audit log. Say what you saw, for example the abuse signal." />
                </ConfirmButton>
              ),
          },
        ]}
        empty={<Empty2 title="No widgets" hint="No website chat widgets match." />}
      />
      <MoreLink href={nextCursor ? href({ ...base, cursor: nextCursor }) : null} />
    </ListCard>
  );
}
