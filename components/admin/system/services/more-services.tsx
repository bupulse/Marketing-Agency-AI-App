import { Bot, KeyRound, MessagesSquare } from "lucide-react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { DataList, EmptyState, PageHeader, StatusPill } from "@/components/admin/kit";
import { Panel } from "@/components/admin/ui";
import { SocialInboxPanel } from "@/components/admin/social-inbox-panel";
import { Field, Input, Textarea } from "@/components/ui";
import { dateTime } from "@/lib/admin/format";
import type { CustomKeyView } from "@/lib/admin/service-keys";
import type { InboxAdminView } from "@/lib/social/inbox/admin";
import { removeCustomKeyAction, saveCustomKeyAction } from "@/app/admin/(console)/(system)/services/actions";
import { Notices } from "../notices";

const BACK = { href: "/admin/services", label: "Services" };

/** /admin/services/inbox: how clients' Instagram and Facebook comments and DMs reach their inbox. */
export function InboxServicePage({ view }: { view: InboxAdminView }) {
  return (
    <>
      <PageHeader icon={MessagesSquare} tone="slate" title="Instagram and Facebook replies" description="How clients' Instagram and Facebook comments and DMs reach their inbox, so automations and their team can answer." back={BACK} />
      <SocialInboxPanel view={view} />
    </>
  );
}

function CustomKeyFields({ k }: { k?: CustomKeyView }) {
  return (
    <>
      <Field label="Name" required hint="What the key is for, for example Seedream images.">
        <Input name="label" defaultValue={k?.label} minLength={2} maxLength={80} required />
      </Field>
      {!k && (
        <Field label="Variable name" required hint="How code reads it: capital letters, digits and _, for example SEEDREAM_API_KEY. It cannot be changed later.">
          <Input name="envName" pattern="[A-Za-z][A-Za-z0-9_]{2,63}" maxLength={64} autoComplete="off" spellCheck={false} required />
        </Field>
      )}
      <Field label="Details" hint="Optional: which account it belongs to, its limits, who to ask.">
        <Textarea name="details" defaultValue={k?.details} maxLength={500} rows={3} />
      </Field>
      <Field label="Website" hint="Optional: the service's dashboard or docs.">
        <Input name="website" type="url" defaultValue={k?.website ?? undefined} maxLength={300} placeholder="https://" />
      </Field>
      <Field label={k ? "New value" : "Key"} required={!k} hint={k ? `Leave empty to keep the saved value (ends ${k.shown}).` : "Only its last 4 characters are shown after saving."}>
        <Input name="value" type="password" autoComplete="off" spellCheck={false} maxLength={4000} required={!k} />
      </Field>
    </>
  );
}

/** /admin/services/custom-keys: keys for any other service; code reads each one by its variable name. */
export function CustomKeysPage({ custom }: { custom: CustomKeyView[] }) {
  return (
    <>
      <PageHeader
        icon={KeyRound}
        tone="slate"
        title="Custom keys"
        description="Keys for any other service, for example an AI model you want to try. Saved encrypted like the others. Nothing in BuPulse uses a custom key until a feature is built for it."
        back={BACK}
        actions={
          <ConfirmButton action={saveCustomKeyAction} fields={{}} label="Add a custom key" title="Add a custom key" description="Saved encrypted and written to the audit log. It never replaces a variable the hosting environment already sets." confirmLabel="Save" pendingLabel="Saving…" variant="primary">
            <CustomKeyFields />
          </ConfirmButton>
        }
      />
      <Panel title={`Saved keys (${custom.length})`} description="Code reads each key by its variable name.">
        <DataList<CustomKeyView>
          caption="Custom keys"
          mode="cards"
          rows={custom}
          rowKey={(k) => k.id}
          columns={[
            {
              key: "label",
              header: "Key",
              primary: true,
              cell: (k) => (
                <span className="flex flex-wrap items-center gap-2">
                  {k.label}
                  <code className="font-mono text-[12px] font-normal">{k.envName}</code>
                </span>
              ),
            },
            { key: "state", header: "State", cell: (k) => (k.inUse ? <StatusPill tone="good" dot>Saved</StatusPill> : <StatusPill tone="bad" dot>Not in use</StatusPill>) },
            {
              key: "details",
              header: "Details",
              cell: (k) => (
                <span className="flex flex-col gap-1 text-[13px]">
                  {k.details && <span>{k.details}</span>}
                  <span className="text-muted">
                    Ends {k.shown} · saved {dateTime(k.savedAt)} by {k.savedBy}
                    {k.website && (
                      <>
                        {" · "}
                        <a href={k.website} target="_blank" rel="noopener noreferrer" className="underline">
                          website
                        </a>
                      </>
                    )}
                  </span>
                  {!k.inUse && <span className="text-danger">It could not be read, or the hosting environment now sets {k.envName}. Save a new value, or remove it.</span>}
                </span>
              ),
            },
            {
              key: "actions",
              header: "Actions",
              cell: (k) => (
                <span className="flex flex-wrap gap-1.5">
                  <ConfirmButton action={saveCustomKeyAction} fields={{ id: k.id }} label="Edit" title={`Edit ${k.label}`} description={`Variable ${k.envName}. The change is written to the audit log.`} confirmLabel="Save" pendingLabel="Saving…">
                    <CustomKeyFields k={k} />
                  </ConfirmButton>
                  <ConfirmButton action={removeCustomKeyAction} fields={{ id: k.id }} label="Remove" title={`Remove ${k.label}?`} description={`Code reading ${k.envName} gets nothing from now on. This cannot be undone; you would paste the key again.`} confirmLabel="Remove" pendingLabel="Removing…" />
                </span>
              ),
            },
          ]}
          empty={<EmptyState icon={KeyRound} title="No custom keys yet." hint="Add one with the button above." />}
        />
      </Panel>
    </>
  );
}

export type RobotView = { enabled: boolean; lastOk: boolean | null; lastRunAt: string | Date | null; made24h: number; failed24h: number; runs24h: number; waiting: number; needsBrowser: number };

/** The robot's state in words, for its card and its page. */
export function robotState(robot: Pick<RobotView, "enabled" | "lastOk" | "lastRunAt">): { label: string; tone: "good" | "bad" | "muted" } {
  if (!robot.enabled) return { label: "Not set up", tone: "muted" };
  if (robot.lastOk === false) return { label: "Last run failed", tone: "bad" };
  if (robot.lastRunAt) return { label: "Working", tone: "good" };
  return { label: "No run yet", tone: "muted" };
}

/** /admin/services/video-robot: the GitHub Actions robot that makes content videos every 15 minutes. */
export function VideoRobotPage({ robot, ok, bad }: { robot: RobotView; ok?: string; bad?: string }) {
  const st = robotState(robot);
  const tiles: [string, string][] = [
    ["Last run", robot.lastRunAt ? dateTime(robot.lastRunAt) : "Never"],
    ["Made, 24 hours", String(robot.made24h)],
    ["Failed, 24 hours", String(robot.failed24h)],
    ["Runs, 24 hours", String(robot.runs24h)],
    ["Waiting", `${robot.waiting} videos`],
    ["Left to the browser", String(robot.needsBrowser)],
  ];
  return (
    <>
      <PageHeader icon={Bot} tone="slate" title="Video robot" description="Makes content videos by itself on GitHub Actions every 15 minutes, in headless Chrome with the same renderer as the browser (docs/VIDEO_ROBOT.md)." back={BACK} actions={<StatusPill tone={st.tone} dot className="px-3 py-1 text-[13px]">{st.label}</StatusPill>} />
      <Notices ok={ok} bad={bad} />
      <Panel title="The last 24 hours" description="A video that fails 3 times is left to the owner's browser, which makes it when the post is opened.">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {tiles.map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-soft px-4 py-3">
              <dt className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">{label}</dt>
              <dd className="text-[16px] font-bold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      <Panel title="Key" description="The robot signs in with this secret.">
        <p className="flex flex-wrap items-center gap-2 text-[14px]">
          <code className="font-mono text-[13px] font-semibold">VIDEO_ROBOT_SECRET</code>
          {robot.enabled ? <StatusPill tone="good" dot>Set</StatusPill> : <StatusPill tone="bad" dot>Missing</StatusPill>}
        </p>
        <p className="rounded-2xl bg-soft px-4 py-3 text-[14px]">
          <strong>If off:</strong> owners make videos in their browser when they open the post, as before.
        </p>
      </Panel>
    </>
  );
}
