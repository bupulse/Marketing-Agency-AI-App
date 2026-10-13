import { Fragment } from "react";
import { requirePermission } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { DeployRuns } from "@/components/admin/deploy-runs";
import { Panel, notice } from "@/components/admin/ui";
import { Badge, Field, Input, Textarea, type BadgeTone } from "@/components/ui";
import { dateTime, param } from "@/lib/admin/format";
import { notesToBlocks } from "@/lib/admin/release-notes";
import { DEPLOY_HOSTS } from "@/lib/admin/deploy-host";
import { getUpdateStatus, type UpdateStatus } from "@/lib/admin/updates";
import { installUpdateAction, rollbackAction } from "./actions";

export const metadata = { title: "Updates" };

const STATE: Record<UpdateStatus["state"], { label: string; tone: BadgeTone }> = {
  up_to_date: { label: "Up to date", tone: "success" },
  update_available: { label: "Update available", tone: "blue" },
  ahead: { label: "Newer than the latest release", tone: "violet" },
  unknown: { label: "Cannot compare", tone: "neutral" },
  not_connected: { label: "Not connected", tone: "neutral" },
};

const DOCS = "https://github.com/%s/blob/main/docs/UPDATES.md";

export default async function UpdatesPage({ searchParams }: PageProps<"/admin/settings/updates">) {
  await requirePermission("system"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const s = await getUpdateStatus();
  const state = STATE[s.state];
  const host = DEPLOY_HOSTS[s.host];
  const docsUrl = s.repo ? DOCS.replace("%s", s.repo) : null;
  const latest = s.latest;
  const latestVersion = latest?.version ?? (latest?.sha ? latest.sha.slice(0, 7) : null);
  const canInstall = s.connected && latest && !s.inFlight && (s.state === "update_available" || s.state === "unknown");

  return (
    <>
      <PageHeader title="Updates" description="The version BuPulse is running, the newest release on GitHub, and the deploys. Installing or rolling back starts the official deploy workflow on GitHub Actions; nothing is uploaded from here." />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      {s.error && <p role="alert" className={notice.bad}>{s.error}</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Running now" description={`What this ${host.runtime} was built from.`} action={<Badge tone={state.tone}>{state.label}</Badge>}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
            <dt className="text-muted">Version</dt>
            <dd className="font-semibold tabular-nums">{s.current.version}</dd>
            <dt className="text-muted">Build</dt>
            <dd>
              <code className="font-mono text-[13px]">{s.current.short}</code>
              {s.current.sha === "local" && <span className="block text-xs text-muted">A local build; the commit is only known for builds made by the deploy workflow.</span>}
            </dd>
            <dt className="text-muted">Repository</dt>
            <dd>{s.repo ? <a href={`https://github.com/${s.repo}`} target="_blank" rel="noreferrer noopener" className="underline">{s.repo}</a> : <span className="text-muted">Not set</span>}</dd>
          </dl>
        </Panel>

        {!s.connected ? (
          <Panel title="Not connected" description="Set GITHUB_REPO and GITHUB_TOKEN so this page can see releases and start deploys.">
            <ol className="list-decimal space-y-1.5 pl-5 text-[14px]">
              <li>Push the code to a GitHub repository and keep <code className="font-mono text-[13px]">.github/workflows/{host.workflow}</code> on <code className="font-mono text-[13px]">main</code>.</li>
              <li>On GitHub: Settings, Developer settings, Fine-grained tokens, create one for that repository with <strong>Actions: Read and write</strong> and <strong>Contents: Read</strong> (Metadata is added by itself).</li>
              <li>{host.runtimeSecrets} For local use add both to <code className="font-mono text-[13px]">.env</code>.</li>
              <li>
                Add the GitHub Actions secrets the workflow needs (
                {host.secrets.map((name, i) => (
                  <Fragment key={name}>
                    {i > 0 && ", "}
                    <code className="font-mono text-[13px]">{name}</code>
                  </Fragment>
                ))}
                ) and the <code className="font-mono text-[13px]">production</code> environment. See docs/UPDATES.md.
              </li>
            </ol>
          </Panel>
        ) : (
          <Panel
            title="Newest release"
            description={latest ? (latest.kind === "release" ? "The latest GitHub release." : latest.kind === "tag" ? "The newest tag (the repository has no releases yet)." : "The tip of main (the repository has no releases or tags yet).") : "GitHub did not answer; try again in a minute."}
            action={latest ? <a href={latest.url} target="_blank" rel="noreferrer noopener" className="text-sm underline">Open on GitHub</a> : undefined}
          >
            {latest && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
                <dt className="text-muted">Version</dt>
                <dd className="font-semibold tabular-nums">{latestVersion}</dd>
                <dt className="text-muted">Name</dt>
                <dd className="break-words">{latest.name}</dd>
                <dt className="text-muted">Published</dt>
                <dd>{latest.publishedAt ? dateTime(latest.publishedAt) : "Unknown"}</dd>
                {latest.sha && (
                  <Fragment>
                    <dt className="text-muted">Commit</dt>
                    <dd><code className="font-mono text-[13px]">{latest.sha.slice(0, 7)}</code></dd>
                  </Fragment>
                )}
              </dl>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {canInstall && latest && latestVersion && (
                <ConfirmButton
                  action={installUpdateAction}
                  fields={{ ref: latest.ref, version: latestVersion }}
                  label={`Install ${latestVersion}`}
                  variant="primary"
                  title={`Install ${latestVersion}?`}
                  description={`GitHub will check out ${latest.ref}, run the database migrations, then build and deploy the new ${host.runtime}. If the production environment has required reviewers, the run waits for approval on GitHub first. The request is written to the audit log.`}
                  confirmLabel="Install update"
                >
                  <Field label={`Type ${latestVersion} to confirm`} hint="Exactly as shown, to be sure you mean this one." required>
                    <Input name="typed" autoComplete="off" required placeholder={latestVersion} />
                  </Field>
                </ConfirmButton>
              )}
              {s.inFlight && <span className="text-sm text-muted">A deploy is already queued or running; wait for it to finish.</span>}
              {!s.inFlight && s.state === "up_to_date" && <span className="text-sm text-muted">Nothing to install.</span>}
              {!s.inFlight && s.state === "ahead" && <span className="text-sm text-muted">This build is newer than the latest release (a push to main after the release).</span>}
            </div>
          </Panel>
        )}
      </div>

      {s.connected && latest?.notes && (
        <Panel title="Release notes" description={`What changed in ${latestVersion}.`}>
          <ReleaseNotes markdown={latest.notes} />
        </Panel>
      )}

      {s.connected && (
        <Panel title="Deploys" description="The last 10 runs of the deploy workflow. A deploy that waits for approval must be approved on GitHub.">
          <DeployRuns initial={{ runs: s.runs, inFlight: s.inFlight }} />
        </Panel>
      )}

      {s.connected && (
        <Panel title="Roll back" description={`Puts the previous ${host.runtime} version back. Use it when an update breaks the site.`}>
          <p className="text-[14px] text-muted">
            Only the {host.runtime} code is rolled back. <strong className="text-text">Database migrations are not undone:</strong> if the update changed the database, the old code must still work with the new tables, or you need a manual migration back.
            {docsUrl && (
              <>
                {" "}Read <a href={docsUrl} target="_blank" rel="noreferrer noopener" className="underline">docs/UPDATES.md</a> first.
              </>
            )}
          </p>
          <div>
            <ConfirmButton
              action={rollbackAction}
              fields={{}}
              label="Roll back to the previous version"
              variant="outline"
              title={`Roll back the ${host.runtime}?`}
              description={`${host.rollback} Database migrations stay as they are. The request is written to the audit log.`}
              confirmLabel="Roll back"
            >
              <Field label="Reason" hint="Saved in the audit log." required>
                <Textarea name="reason" rows={2} minLength={3} maxLength={200} required />
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="confirm" required className="mt-1 size-4" />
                <span>I understand that database migrations are not rolled back and that the previous version must work with the current database.</span>
              </label>
            </ConfirmButton>
          </div>
        </Panel>
      )}
    </>
  );
}

/** Markdown rendered as plain blocks: no HTML from GitHub ever reaches the page. */
function ReleaseNotes({ markdown }: { markdown: string }) {
  const blocks = notesToBlocks(markdown);
  if (blocks.length === 0) return <p className="text-sm text-muted">No notes.</p>;
  return (
    <div className="flex flex-col gap-2 text-[14px]">
      {blocks.map((b, i) =>
        b.type === "heading" ? (
          <h3 key={i} className="mt-1 font-semibold">{b.text}</h3>
        ) : b.type === "list" ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="whitespace-pre-wrap break-words">{b.text}</p>
        ),
      )}
    </div>
  );
}
