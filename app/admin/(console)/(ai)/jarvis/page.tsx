import { requirePermission } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Empty, Panel, notice } from "@/components/admin/ui";
import { Badge } from "@/components/ui";
import { dateTime, param } from "@/lib/admin/format";
import { listAdminKeys } from "@/lib/admin/keys";
import { revokeKeyAction } from "@/app/admin/(console)/actions";
import { CopyField, CreateKeyForm, RotateKey } from "./key-forms";
import { linkSiteUrl } from "@/lib/auth/request-site";

export const metadata = { title: "Jarvis" };

export default async function JarvisPage({ searchParams }: PageProps<"/admin/jarvis">) {
  await requirePermission("jarvis"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const keys = await listAdminKeys();
  const base = (await linkSiteUrl());
  const mcp = `${base}/api/mcp`;
  const active = keys.filter((k) => !k.revokedAt);
  const revoked = keys.filter((k) => k.revokedAt);

  return (
    <>
      <PageHeader title="Jarvis" description="Keys that let Jarvis read BuPulse and run admin actions. Every call is written to the audit log; refunds and paid plan changes only wait here for your Approve. A key made by a staff member can run only the tools their own permissions allow, and stops working if they are disabled." />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}

      <Panel title="Connect Jarvis">
        <div className="flex flex-col gap-3">
          <div><p className="mb-1 text-[13px] font-medium text-muted">MCP server URL</p><CopyField value={mcp} label="MCP URL" /></div>
          <div><p className="mb-1 text-[13px] font-medium text-muted">REST API base</p><CopyField value={`${base}/api/admin/v1`} label="REST base URL" /></div>
          <ol className="list-decimal space-y-1 pl-5 text-[15px]">
            <li>Create a key below and copy it. You will not see it again.</li>
            <li>In Jarvis, add a connector (MCP server) with the URL above.</li>
            <li>Set the authorization header to <code className="rounded bg-soft px-1.5 py-0.5 font-mono text-[13px]">Bearer &lt;your key&gt;</code>.</li>
            <li>Ask Jarvis: “How did BuPulse do this week and what’s working?”</li>
          </ol>
          <p className="text-[13px] text-muted">Add an allowed IP address to a key if Jarvis runs from a fixed address. If it does not, leave it empty and rotate the key regularly.</p>
        </div>
      </Panel>

      <Panel title="Create a key">
        <CreateKeyForm />
      </Panel>

      <Panel title="Keys" description="Only the start of each key is kept; the rest is stored as a one-way hash.">
        {active.length === 0 ? (
          <Empty>No active keys. Create one to connect Jarvis.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {active.map((k) => (
              <li key={k.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="font-semibold">{k.name} <code className="ml-1 rounded bg-soft px-1.5 py-0.5 font-mono text-xs font-normal">{k.prefix}…</code></p>
                  <p className="text-[13px] text-muted">Created {dateTime(k.createdAt)} · {k.lastUsedAt ? `last used ${dateTime(k.lastUsedAt)}` : "never used"}</p>
                  <p className="text-[13px] text-muted">{k.ipAllowList.length ? `Only from ${k.ipAllowList.join(", ")}` : "Any IP address"}</p>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <RotateKey id={k.id} name={k.name} />
                  <ConfirmButton action={revokeKeyAction} fields={{ id: k.id }} label="Revoke" title={`Revoke “${k.name}”?`} description="Jarvis loses access straight away. This cannot be undone." confirmLabel="Revoke key" />
                </div>
              </li>
            ))}
          </ul>
        )}
        {revoked.length > 0 && (
          <details className="text-sm text-muted">
            <summary className="min-h-11 cursor-pointer py-2.5">{revoked.length} revoked</summary>
            <ul className="flex flex-col gap-1">
              {revoked.map((k) => (<li key={k.id}><Badge tone="neutral">Revoked</Badge> {k.name} ({k.prefix}…) {dateTime(k.revokedAt!)}</li>))}
            </ul>
          </details>
        )}
      </Panel>
    </>
  );
}
