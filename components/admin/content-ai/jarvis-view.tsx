import { Bot, KeyRound, Link2, Plus, ShieldCheck } from "lucide-react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { dateTime } from "@/lib/admin/format";
import type { listAdminKeys } from "@/lib/admin/keys";
import { cn } from "@/lib/cn";
import { revokeKeyAction } from "@/app/admin/(console)/actions";
import { CopyField, CreateKeyForm, RotateKey } from "@/app/admin/(console)/(ai)/jarvis/key-forms";
import { CARD, EmptyState, ExpandCard, IconBadge, PageHeader, StatGrid, StatTile, StatusPill } from "../kit";
import { notice } from "../ui";

type AdminKey = Awaited<ReturnType<typeof listAdminKeys>>[number];

/**
 * Jarvis: two numbers, the active keys as cards (rotate, revoke), "Create a key" and "Connect Jarvis" as cards that
 * open on hover or tap, and the revoked keys folded away.
 */
export function JarvisView({ keys, base, message }: { keys: AdminKey[]; base: string; message: { notice?: string; error?: string } }) {
  const active = keys.filter((k) => !k.revokedAt);
  const revoked = keys.filter((k) => k.revokedAt);
  const lastUsed = active.map((k) => k.lastUsedAt).filter((d): d is NonNullable<typeof d> => !!d).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  return (
    <>
      <PageHeader icon={Bot} tone="violet" title="Jarvis" description="Keys that let Jarvis read BuPulse and run admin actions. Every call is written to the audit log; refunds and paid plan changes wait in Approvals for you." />
      {message.notice && <p role="status" className={notice.ok}>{message.notice}</p>}
      {message.error && <p role="alert" className={notice.bad}>{message.error}</p>}
      <StatGrid cols={2} className="lg:grid-cols-2">
        <StatTile icon={KeyRound} tone="violet" label="Active keys" value={String(active.length)} hint="Each one lets Jarvis in. Revoke any you no longer use." />
        <StatTile icon={ShieldCheck} tone="violet" label="Last used" value={lastUsed ? dateTime(lastUsed).replace(/ UTC$/, "") : "Never"} hint="The latest call from any key." />
      </StatGrid>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <ExpandCard icon={Plus} tone="violet" title="Create a key" summary="Copy it at once: you will not see it again." defaultOpen={active.length === 0}>
          <CreateKeyForm />
        </ExpandCard>
        <ExpandCard icon={Link2} tone="violet" title="Connect Jarvis" summary="The server address and four steps.">
          <div className="flex flex-col gap-3">
            <div><p className="mb-1 text-[13px] font-medium text-muted">MCP server URL</p><CopyField value={`${base}/api/mcp`} label="MCP URL" /></div>
            <div><p className="mb-1 text-[13px] font-medium text-muted">REST API base</p><CopyField value={`${base}/api/admin/v1`} label="REST base URL" /></div>
            <ol className="flex flex-col gap-2 text-[14px]">
              {[
                "Create a key and copy it. You will not see it again.",
                "In Jarvis, add a connector (MCP server) with the URL above.",
                <>Set the authorization header to <code className="rounded bg-soft px-1.5 py-0.5 font-mono text-[13px]">Bearer &lt;your key&gt;</code>.</>,
                "Ask Jarvis: “How did BuPulse do this week and what’s working?”",
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-pulse-violet/12 text-[12px] font-bold text-pulse-violet dark:bg-pulse-violet/25 dark:text-[#b7a6ff]">{i + 1}</span>
                  <span className="min-w-0">{step}</span>
                </li>
              ))}
            </ol>
            <p className="text-[13px] text-muted">A key made by a staff member can run only the tools their own permissions allow, and stops working if they are disabled. Add an allowed IP address if Jarvis runs from a fixed address; if not, rotate the key regularly.</p>
          </div>
        </ExpandCard>
      </div>
      <div className="flex flex-col gap-1 px-1">
        <h2 className="text-[17px] font-bold tracking-[-0.02em]">Keys</h2>
        <p className="text-[13px] text-muted">Only the start of each key is kept; the rest is stored as a one-way hash.</p>
      </div>
      {active.length === 0 ? (
        <EmptyState icon={KeyRound} title="No active keys." hint="Create one to connect Jarvis." />
      ) : (
        <ul className="kit-rise grid items-start gap-3 lg:grid-cols-2">
          {active.map((k) => (
            <li key={k.id} className={cn("flex min-w-0 flex-col gap-3 p-4 sm:p-5", CARD)}>
              <div className="flex items-start gap-3">
                <IconBadge icon={KeyRound} tone="violet" size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold">{k.name} <code className="ml-1 rounded bg-soft px-1.5 py-0.5 font-mono text-xs font-normal">{k.prefix}…</code></p>
                  <p className="text-[13px] text-muted">Created {dateTime(k.createdAt)} · {k.lastUsedAt ? `last used ${dateTime(k.lastUsedAt)}` : "never used"}</p>
                  <p className="text-[13px] text-muted">{k.ipAllowList.length ? `Only from ${k.ipAllowList.join(", ")}` : "Any IP address"}</p>
                </div>
                <StatusPill tone={k.lastUsedAt ? "good" : "muted"} dot>{k.lastUsedAt ? "In use" : "Not used yet"}</StatusPill>
              </div>
              <div className="flex flex-wrap items-start gap-2 border-t border-line pt-3">
                <RotateKey id={k.id} name={k.name} />
                <ConfirmButton action={revokeKeyAction} fields={{ id: k.id }} label="Revoke" title={`Revoke “${k.name}”?`} description="Jarvis loses access straight away. This cannot be undone." confirmLabel="Revoke key" />
              </div>
            </li>
          ))}
        </ul>
      )}
      {revoked.length > 0 && (
        <details className={cn("px-4 text-sm text-muted", CARD)}>
          <summary className="min-h-11 cursor-pointer py-3 font-semibold">{revoked.length} revoked</summary>
          <ul className="flex flex-col gap-1.5 pb-4">
            {revoked.map((k) => (<li key={k.id} className="flex flex-wrap items-center gap-2"><StatusPill tone="muted">Revoked</StatusPill> {k.name} ({k.prefix}…) {dateTime(k.revokedAt!)}</li>))}
          </ul>
        </details>
      )}
    </>
  );
}
