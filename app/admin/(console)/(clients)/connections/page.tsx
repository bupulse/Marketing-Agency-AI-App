import Link from "next/link";
import { Plug } from "lucide-react";
import { requirePermission } from "@/lib/admin/auth";
import { EmptyState, PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Panel, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { Badge, Button, Field, Input, Select, Textarea, type BadgeTone } from "@/components/ui";
import { cn } from "@/lib/cn";
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
const NETWORK_NAME: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", twitter: "X" };
const STATUS_UI: Record<ChannelStatus, { label: string; tone: BadgeTone }> = {
  healthy: { label: "Healthy", tone: "success" },
  expiring: { label: "Token expiring", tone: "violet" },
  expired: { label: "Expired", tone: "danger" },
  needs_reconnect: { label: "Needs reconnect", tone: "danger" },
};

const href = (params: Record<string, string | undefined>) => `/admin/connections?${new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])))}`;
const when = (d: Date | null) => (d ? dateTime(d) : "Never");

function Client({ b }: { b: { name: string; ownerEmail: string; userId: string } }) {
  return (
    <>
      <Link href={`/admin/users/${b.userId}`} className="block max-w-[14rem] truncate font-medium underline">{b.name}</Link>
      <span className="block max-w-[14rem] truncate text-xs text-muted">{b.ownerEmail}</span>
    </>
  );
}

function PillNav({ label, items, current, make }: { label: string; items: readonly (readonly [string, string])[]; current: string; make: (key: string) => string }) {
  return (
    <nav aria-label={label} className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-soft p-1">
      {items.map(([k, l]) => (
        <Link
          key={k}
          href={make(k)}
          aria-current={current === k ? "page" : undefined}
          className={cn("inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-medium no-underline", current === k ? "bg-surface text-text shadow-glass" : "text-muted")}
        >
          {l}
        </Link>
      ))}
    </nav>
  );
}

function Reason({ required, hint }: { required?: boolean; hint?: string }) {
  return (
    <Field label={required ? "Reason" : "Reason (optional)"} hint={hint ?? "Saved in the audit log."} required={required}>
      <Textarea name="reason" rows={2} maxLength={300} required={required} />
    </Field>
  );
}

function More({ next }: { next: string | null }) {
  return next ? <Button href={next} variant="outline" className="self-start">Next page</Button> : null;
}

export default async function ConnectionsPage({ searchParams }: PageProps<"/admin/connections">) {
  await requirePermission("clients.view"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === param(sp.tab)) ? param(sp.tab) : "channels";
  const kind = KINDS.some(([k]) => k === param(sp.kind)) ? param(sp.kind) : "store";
  const q = param(sp.q);
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
      <PageHeader title="Connections" description="Every client's social channels, connectors, webhooks, API keys and website chat. Actions here are saved in the audit log." />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      <PillNav label="Connection types" items={TABS} current={tab} make={(k) => href({ tab: k })} />
      {bad && <p role="alert" className={notice.bad}>{bad}</p>}
      {!bad && body}
    </>
  );
}

type View = { here: string; base: Record<string, string | undefined> };

function SearchBar({ q, base, children, placeholder = "Business name or email" }: { q: string; base: Record<string, string | undefined>; children?: React.ReactNode; placeholder?: string }) {
  return (
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_11rem_11rem_auto]" role="search">
      <input type="hidden" name="tab" value={base.tab} />
      {base.kind && <input type="hidden" name="kind" value={base.kind} />}
      <Input name="q" defaultValue={q} placeholder={placeholder} aria-label="Search" />
      {children}
      <Button type="submit">Search</Button>
    </form>
  );
}

async function Channels({ q, network, status, cursor, here, base }: { q: string; network: string; status: string; cursor?: string } & View) {
  const { items, nextCursor } = await listChannels({ q, network, status, cursor });
  const filtered = Boolean(q || network || status);
  return (
    <Panel title="Social channels" description="Instagram, Facebook, LinkedIn, TikTok and YouTube accounts. Force disconnect erases the tokens but keeps the account and its posts.">
      <SearchBar q={q} base={base}>
        <Select name="f1" defaultValue={network} aria-label="Network">
          <option value="">Any network</option>
          {Object.entries(NETWORK_NAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select name="f2" defaultValue={status} aria-label="Status">
          <option value="">Any status</option>
          {CHANNEL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_UI[s].label}</option>)}
        </Select>
      </SearchBar>
      {items.length === 0 ? (
        <EmptyState icon={Plug} title={filtered ? "No channels match" : "No channels yet"} text={filtered ? "Try a different search or clear the filters." : "Connected accounts appear here."} action={filtered ? <Button href="/admin/connections" variant="outline">Clear filters</Button> : undefined} />
      ) : (
        <TableWrap caption="Social channels">
          <thead><tr><Th>Client</Th><Th>Account</Th><Th>Status</Th><Th>Token expires</Th><Th>Last publish OK</Th><Th right>Failed, 7 days</Th><Th>Actions</Th></tr></thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <Td><Client b={c.business} /></Td>
                <Td className="max-w-[14rem]"><span className="block truncate font-medium">{c.accountName}</span><span className="block text-xs text-muted">{NETWORK_NAME[c.network] ?? c.network} · {c.accountType ?? "account"}{c.postingMode === "NOTIFY" ? " · reminders" : ""}</span></Td>
                <Td>
                  <Badge tone={STATUS_UI[c.status].tone}>{STATUS_UI[c.status].label}</Badge>
                  {c.lastError && <span className="mt-1 block max-w-[14rem] text-xs text-muted">{c.lastError}</span>}
                </Td>
                <Td className="whitespace-nowrap">{c.expiresAt ? dateTime(c.expiresAt) : <span className="text-muted">None</span>}</Td>
                <Td className="whitespace-nowrap">{when(c.lastPublishOkAt)}</Td>
                <Td right>{c.failedPosts7d > 0 ? <span className="font-semibold text-danger">{num(c.failedPosts7d)}</span> : "0"}</Td>
                <Td>
                  {c.rawStatus === "REVOKED" && c.status === "needs_reconnect" && c.lastError?.startsWith("Disconnected by") ? (
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

async function Connectors({ kind, q, f1, f2, cursor, here, base }: { kind: string; q: string; f1: string; f2: string; cursor?: string } & View) {
  const nav = <PillNav label="Connector type" items={KINDS} current={kind} make={(k) => href({ tab: "connectors", kind: k })} />;
  if (kind === "store") {
    const { items, nextCursor } = await listStoreConnections({ q, provider: f1, status: f2, cursor });
    return (
      <Panel title="Connectors" description="Shopify and WooCommerce stores. Disconnecting removes the saved keys; imported products stay." action={nav}>
        <SearchBar q={q} base={base}>
          <Select name="f1" defaultValue={f1} aria-label="Store"><option value="">Any store type</option><option value="shopify">Shopify</option><option value="woocommerce">WooCommerce</option></Select>
          <Select name="f2" defaultValue={f2} aria-label="Status"><option value="">Any status</option><option value="ACTIVE">Active</option><option value="NEEDS_ATTENTION">Needs attention</option></Select>
        </SearchBar>
        {items.length === 0 ? <Empty2 /> : (
          <TableWrap caption="Store connections">
            <thead><tr><Th>Client</Th><Th>Store</Th><Th>Status</Th><Th>Last sync</Th><Th right>Products</Th><Th>Last error</Th><Th>Actions</Th></tr></thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <Td><Client b={s.business} /></Td>
                  <Td className="max-w-[14rem]"><span className="block truncate font-medium">{s.store}</span><span className="text-xs text-muted">{s.provider === "shopify" ? "Shopify" : "WooCommerce"}</span></Td>
                  <Td><Badge tone={s.status === "ACTIVE" ? "success" : "danger"}>{s.status === "ACTIVE" ? "Active" : "Needs attention"}</Badge></Td>
                  <Td className="whitespace-nowrap">{when(s.lastSyncAt)}</Td>
                  <Td right>{num(s.products)}</Td>
                  <Td className="max-w-[16rem] text-xs text-muted">{s.lastError ?? ""}</Td>
                  <Td><DisconnectButton kind="store" id={s.id} here={here} what={`${s.store}`} /></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <More next={nextCursor ? href({ ...base, cursor: nextCursor }) : null} />
      </Panel>
    );
  }
  if (kind === "cloudflare") {
    const { items, nextCursor } = await listCloudflareConnections({ q, status: f2, cursor });
    return (
      <Panel title="Connectors" description="Cloudflare tokens and the chat-widget installs made with them." action={nav}>
        <SearchBar q={q} base={base}>
          <span className="hidden lg:block" />
          <Select name="f2" defaultValue={f2} aria-label="Status"><option value="">Any status</option><option value="ACTIVE">Active</option><option value="NEEDS_ATTENTION">Needs attention</option></Select>
        </SearchBar>
        {items.length === 0 ? <Empty2 /> : (
          <TableWrap caption="Cloudflare connections">
            <thead><tr><Th>Client</Th><Th>Status</Th><Th right>Installs</Th><Th>Domains</Th><Th>Connected</Th><Th>Actions</Th></tr></thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <Td><Client b={c.business} /></Td>
                  <Td><Badge tone={c.status === "ACTIVE" ? "success" : "danger"}>{c.status === "ACTIVE" ? "Active" : "Needs attention"}</Badge></Td>
                  <Td right>{num(c.installCount)}</Td>
                  <Td className="max-w-[16rem] truncate text-xs">{c.zones.join(", ") || <span className="text-muted">None</span>}</Td>
                  <Td className="whitespace-nowrap">{dateTime(c.connectedAt)}</Td>
                  <Td><DisconnectButton kind="cloudflare" id={c.id} here={here} what="Cloudflare" /></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <More next={nextCursor ? href({ ...base, cursor: nextCursor }) : null} />
      </Panel>
    );
  }
  if (kind === "canva") {
    const { items, nextCursor } = await listCanvaConnections({ q, cursor });
    return (
      <Panel title="Connectors" description="Linked Canva accounts. The short-lived token refreshes itself when the owner uses Canva." action={nav}>
        <SearchBar q={q} base={base} />
        {items.length === 0 ? <Empty2 /> : (
          <TableWrap caption="Canva connections">
            <thead><tr><Th>Client</Th><Th>Status</Th><Th>Token expiry</Th><Th right>Imports</Th><Th>Connected</Th><Th>Actions</Th></tr></thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <Td><Client b={c.business} /></Td>
                  <Td><Badge tone="success">Connected</Badge></Td>
                  <Td className="whitespace-nowrap">{dateTime(c.tokenExpiresAt)}{c.tokenExpired && <span className="block text-xs text-muted">Refreshes on next use</span>}</Td>
                  <Td right>{num(c.imports)}</Td>
                  <Td className="whitespace-nowrap">{dateTime(c.connectedAt)}</Td>
                  <Td><DisconnectButton kind="canva" id={c.id} here={here} what="Canva" /></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <More next={nextCursor ? href({ ...base, cursor: nextCursor }) : null} />
      </Panel>
    );
  }
  const { items, nextCursor } = await listFileImportUsage({ q, cursor });
  return (
    <Panel title="Connectors" description="Google Drive and Dropbox use the file picker and keep no login, so there is nothing to disconnect. This is how many files each client imported." action={nav}>
      <SearchBar q={q} base={base} />
      {items.length === 0 ? <Empty2 /> : (
        <TableWrap caption="Drive and Dropbox imports">
          <thead><tr><Th>Client</Th><Th right>Drive files</Th><Th>Last Drive import</Th><Th right>Dropbox files</Th><Th>Last Dropbox import</Th></tr></thead>
          <tbody>
            {items.map((b) => (
              <tr key={b.id}>
                <Td><Client b={b.business} /></Td>
                <Td right>{num(b.googleDrive.files)}</Td>
                <Td className="whitespace-nowrap">{when(b.googleDrive.lastAt)}</Td>
                <Td right>{num(b.dropbox.files)}</Td>
                <Td className="whitespace-nowrap">{when(b.dropbox.lastAt)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <More next={nextCursor ? href({ ...base, cursor: nextCursor }) : null} />
    </Panel>
  );
}

function Empty2() {
  return <EmptyState icon={Plug} title="Nothing here" text="No connections match. Try a different search or clear the filters." action={<Button href="/admin/connections?tab=connectors" variant="outline">Clear filters</Button>} />;
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
      <Panel title="Webhooks" description="Only the web address's host is shown, never the full address or the signing secret.">
        <SearchBar q={q} base={base}>
          <Select name="f1" defaultValue={state} aria-label="State"><option value="">Any state</option><option value="active">Running</option><option value="paused">Paused or off</option><option value="failing">Failing</option></Select>
          <span className="hidden lg:block" />
        </SearchBar>
        {hooks.items.length === 0 ? (
          <EmptyState icon={Plug} title="No webhooks" text="No webhook endpoints match." />
        ) : (
          <TableWrap caption="Webhook endpoints">
            <thead><tr><Th>Client</Th><Th>Endpoint</Th><Th>Events</Th><Th right>Success, 7 days</Th><Th right>Failure streak</Th><Th>Last error</Th><Th>Actions</Th></tr></thead>
            <tbody>
              {hooks.items.map((h) => (
                <tr key={h.id}>
                  <Td><Client b={h.business} /></Td>
                  <Td className="max-w-[14rem]"><span className="block truncate font-medium">{h.host}</span><Badge tone={h.pausedBySupport ? "danger" : h.enabled ? "success" : "neutral"}>{h.pausedBySupport ? "Paused (support)" : h.enabled ? "Running" : "Off (owner)"}</Badge>{h.pauseReason && <span className="mt-1 block text-xs text-muted">{h.pauseReason}</span>}</Td>
                  <Td className="max-w-[12rem] text-xs">{h.events.join(", ")}</Td>
                  <Td right>{h.successRate7d == null ? <span className="text-muted">No deliveries</span> : `${h.successRate7d}% of ${num(h.deliveries7d)}`}</Td>
                  <Td right>{h.failureStreak > 0 ? <span className="font-semibold text-danger">{h.failureStreak}</span> : "0"}</Td>
                  <Td className="max-w-[14rem] text-xs text-muted">{h.lastError ?? ""}</Td>
                  <Td>
                    {h.pausedBySupport ? (
                      <ConfirmButton action={resumeWebhookAction} fields={{ id: h.id, back: here }} label="Resume" title={`Resume ${h.host}?`} description="Events are sent again and the failure streak starts from zero." confirmLabel="Resume">
                        <Reason />
                      </ConfirmButton>
                    ) : h.enabled ? (
                      <ConfirmButton action={pauseWebhookAction} fields={{ id: h.id, back: here }} label="Pause" title={`Pause ${h.host}?`} description="No more events are sent to this endpoint until you resume it, and the owner cannot turn it back on. Events in between are not replayed." confirmLabel="Pause">
                        <Reason required hint="Saved in the audit log." />
                      </ConfirmButton>
                    ) : (
                      <span className="text-xs text-muted">Switched off by the owner</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <More next={hooks.nextCursor ? href({ ...base, cursor: hooks.nextCursor, kcursor }) : null} />
      </Panel>
      <Panel title="API keys" description="Pro plan keys. Only the first characters of a key are stored in readable form; the key itself is never available. Calls are counted over the last two days.">
        {keys.items.length === 0 ? (
          <EmptyState icon={Plug} title="No API keys" text="No active client API keys match." />
        ) : (
          <TableWrap caption="Client API keys">
            <thead><tr><Th>Client</Th><Th>Key</Th><Th>Scopes</Th><Th>Last used</Th><Th right>Calls, 2 days</Th><Th>Actions</Th></tr></thead>
            <tbody>
              {keys.items.map((k) => (
                <tr key={k.id}>
                  <Td><Client b={k.business} /></Td>
                  <Td className="max-w-[14rem]"><span className="block truncate font-medium">{k.name}</span><code className="text-xs text-muted">{k.prefix}…</code></Td>
                  <Td className="max-w-[14rem] text-xs">{k.scopes.join(", ")}</Td>
                  <Td className="whitespace-nowrap">{when(k.lastUsedAt)}</Td>
                  <Td right>{num(k.calls2d)}</Td>
                  <Td>
                    <ConfirmButton action={revokeApiKeyAction} fields={{ id: k.id, back: here }} label="Revoke" title={`Revoke ${k.name}?`} description="The key stops working at once. The owner can make a new one." confirmLabel="Revoke">
                      <Reason />
                    </ConfirmButton>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <More next={keys.nextCursor ? href({ ...base, cursor, kcursor: keys.nextCursor }) : null} />
      </Panel>
    </>
  );
}

const SIGNAL: Record<string, { label: string; tone: BadgeTone }> = { ok: { label: "Normal", tone: "success" }, watch: { label: "Watch", tone: "violet" }, high: { label: "High", tone: "danger" } };

async function Widgets({ q, state, cursor, here, base }: { q: string; state: string; cursor?: string } & View) {
  const { items, nextCursor } = await listWidgets({ q, state, cursor });
  return (
    <Panel title="Website chat widgets" description="Chats and leads are counted per visitor conversation. The abuse signal looks at traffic spikes, refused requests (rate limits) and visits from sites that are not on the allowed list.">
      <SearchBar q={q} base={base}>
        <Select name="f1" defaultValue={state} aria-label="State"><option value="">Any state</option><option value="on">On</option><option value="off">Off (owner)</option><option value="support_off">Off (support)</option></Select>
        <span className="hidden lg:block" />
      </SearchBar>
      {items.length === 0 ? (
        <EmptyState icon={Plug} title="No widgets" text="No website chat widgets match." />
      ) : (
        <TableWrap caption="Website chat widgets">
          <thead><tr><Th>Client</Th><Th>Sites</Th><Th>Last seen</Th><Th right>Chats 7d / 30d</Th><Th right>Leads 7d / 30d</Th><Th right>Replies used</Th><Th>Abuse signal</Th><Th>Actions</Th></tr></thead>
          <tbody>
            {items.map((w) => (
              <tr key={w.id}>
                <Td>
                  <Client b={w.business} />
                  <Badge tone={w.switchedOffBySupport ? "danger" : w.enabled ? "success" : "neutral"}>{w.switchedOffBySupport ? "Off (support)" : w.enabled ? "On" : "Off (owner)"}</Badge>
                </Td>
                <Td className="max-w-[14rem] text-xs">{w.openToAnySite ? <span className="font-semibold text-danger">Any site allowed</span> : w.allowedDomains.join(", ")}</Td>
                <Td className="whitespace-nowrap">{w.lastSeenAt ? <>{dateTime(w.lastSeenAt)}<span className="block max-w-[12rem] truncate text-xs text-muted">{w.lastSeenHost}</span></> : <span className="text-muted">Never</span>}</Td>
                <Td right>{num(w.chats7d)} / {num(w.chats30d)}</Td>
                <Td right>{num(w.leads7d)} / {num(w.leads30d)}</Td>
                <Td right className={w.credits.limit > 0 && w.credits.used >= w.credits.limit ? "font-semibold text-danger" : undefined}>{num(w.credits.used)} of {num(w.credits.limit)}</Td>
                <Td>
                  <Badge tone={SIGNAL[w.signal].tone}>{SIGNAL[w.signal].label}</Badge>
                  <span className="mt-1 block max-w-[14rem] text-xs text-muted">
                    {[w.spike && "traffic spike", w.refusedRequests > 0 && `${num(w.refusedRequests)} requests refused`, w.hostMismatch && "seen on a site not on the list"].filter(Boolean).join(", ")}
                  </span>
                </Td>
                <Td>
                  {w.switchedOffBySupport ? (
                    <ConfirmButton action={switchOnWidgetAction} fields={{ id: w.id, back: here }} label="Switch on" title={`Switch on the chat for ${w.business.name}?`} description={`It was switched off${w.switchOffReason ? `: ${w.switchOffReason}` : ""}. The owner's own on/off setting applies again.`} confirmLabel="Switch on" />
                  ) : (
                    <ConfirmButton action={switchOffWidgetAction} fields={{ id: w.id, back: here }} label="Switch off" title={`Switch off the chat for ${w.business.name}?`} description="The chat stops answering visitors at once. The owner sees it as switched off, with a Contact support link, and cannot turn it back on." confirmLabel="Switch off">
                      <Reason required hint="Saved in the audit log. Say what you saw, for example the abuse signal." />
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
