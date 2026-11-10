import { Fragment } from "react";
import { CloudDownload, FileText, History, Package, Rocket, Server, Undo2, Upload } from "lucide-react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { DeployRuns } from "@/components/admin/deploy-runs";
import { ReleaseUpload } from "@/components/admin/release-upload";
import { EmptyState, ExpandCard, PageHeader, StatusPill, type PillTone } from "@/components/admin/kit";
import { Panel, notice } from "@/components/admin/ui";
import { Field, Input, Textarea } from "@/components/ui";
import { dateTime } from "@/lib/admin/format";
import { notesToBlocks } from "@/lib/admin/release-notes";
import { DEPLOY_HOSTS } from "@/lib/admin/deploy-host";
import type { UpdateStatus } from "@/lib/admin/updates";
import type { ReleaseRow } from "@/lib/updates/releases";
import { installReleaseAction, installUpdateAction, restoreReleaseAction, rollbackAction } from "@/app/admin/(console)/(system)/settings/updates/actions";
import { Notices } from "./notices";

const STATE: Record<UpdateStatus["state"], { label: string; tone: PillTone }> = {
  up_to_date: { label: "Up to date", tone: "good" },
  update_available: { label: "Update available", tone: "info" },
  ahead: { label: "Newer than the latest release", tone: "new" },
  unknown: { label: "Cannot compare", tone: "muted" },
  not_connected: { label: "Not connected", tone: "muted" },
};

const RELEASE_STATUS: Record<string, { label: string; tone: PillTone }> = {
  verified: { label: "Verified, not installed", tone: "info" },
  installing: { label: "Installing", tone: "new" },
  installed: { label: "Running", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  superseded: { label: "Installed before", tone: "muted" },
};

const DOCS = "https://github.com/%s/blob/main/docs/UPDATES.md";

/** A small labelled value in a soft box. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl bg-soft px-4 py-3">
      <dt className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-[15px] font-semibold">{children}</dd>
    </div>
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

/** Admin -> Settings -> Updates: what runs now, the newest release, deploys, signed zips, and roll back folded away. */
export function UpdatesView({ s, releases, isOwner, signingKey, dryRun, ok, bad }: { s: UpdateStatus; releases: ReleaseRow[]; isOwner: boolean; signingKey: string | null; dryRun: boolean; ok?: string; bad?: string }) {
  const state = STATE[s.state];
  const host = DEPLOY_HOSTS[s.host];
  const docsUrl = s.repo ? DOCS.replace("%s", s.repo) : null;
  const latest = s.latest;
  const latestVersion = latest?.version ?? (latest?.sha ? latest.sha.slice(0, 7) : null);
  const canInstall = s.connected && latest && !s.inFlight && (s.state === "update_available" || s.state === "unknown");

  return (
    <>
      <PageHeader icon={CloudDownload} tone="slate" title="Updates" description="The version BuPulse runs, the newest release, and versions you uploaded as signed zips. Every install, restore or rollback runs the official deploy on GitHub." back={{ href: "/admin/settings", label: "Settings" }} actions={<StatusPill tone={state.tone} dot className="px-3 py-1 text-[13px]">{state.label}</StatusPill>} />
      <Notices ok={ok} bad={bad} />
      {s.error && <p role="alert" className={notice.bad}>{s.error}</p>}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Panel icon={Server} tone="slate" title="Running now" description={`What this ${host.runtime} was built from.`}>
          <dl className="grid grid-cols-2 gap-2">
            <Fact label="Version">
              <span className="tabular-nums">{s.current.version}</span>
            </Fact>
            <Fact label="Build">
              <code className="font-mono text-[13px]">{s.current.short}</code>
            </Fact>
          </dl>
          {s.current.sha === "local" && <p className="text-[12.5px] text-muted">A local build: the commit is only known for builds made by the deploy workflow.</p>}
          <p className="text-[13px] text-muted">
            Repository:{" "}
            {s.repo ? (
              <a href={`https://github.com/${s.repo}`} target="_blank" rel="noreferrer noopener" className="underline">
                {s.repo}
              </a>
            ) : (
              "not set"
            )}
          </p>
        </Panel>

        {!s.connected ? (
          <Panel icon={Rocket} tone="slate" title="Not connected" description="Set GITHUB_REPO and GITHUB_TOKEN so this page can see releases and start deploys.">
            <ol className="list-decimal space-y-1.5 pl-5 text-[14px]">
              <li>
                Push the code to a GitHub repository and keep <code className="font-mono text-[13px]">.github/workflows/{host.workflow}</code> on <code className="font-mono text-[13px]">main</code>.
              </li>
              <li>
                On GitHub: Settings, Developer settings, Fine-grained tokens, create one for that repository with <strong>Actions: Read and write</strong> and <strong>Contents: Read</strong> (Metadata is added by itself).
              </li>
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
            icon={Rocket}
            tone="slate"
            title="Newest release"
            description={latest ? (latest.kind === "release" ? "The latest GitHub release." : latest.kind === "tag" ? "The newest tag (no releases yet)." : "The tip of main (no releases or tags yet).") : "GitHub did not answer; try again in a minute."}
            action={
              latest ? (
                <a href={latest.url} target="_blank" rel="noreferrer noopener" className="text-sm font-semibold underline">
                  Open on GitHub
                </a>
              ) : undefined
            }
          >
            {latest && (
              <dl className="grid grid-cols-2 gap-2">
                <Fact label="Version">
                  <span className="tabular-nums">{latestVersion}</span>
                </Fact>
                <Fact label="Published">{latest.publishedAt ? dateTime(latest.publishedAt) : "Unknown"}</Fact>
                <div className="col-span-2">
                  <Fact label="Name">{latest.name}</Fact>
                </div>
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
        <ExpandCard icon={FileText} tone="slate" title="Release notes" summary={`What changed in ${latestVersion}.`}>
          <ReleaseNotes markdown={latest.notes} />
        </ExpandCard>
      )}

      {s.connected && (
        <Panel icon={History} tone="slate" title="Deploys" description="The last 10 runs of the deploy workflow. A deploy that waits for approval must be approved on GitHub.">
          <DeployRuns initial={{ runs: s.runs, inFlight: s.inFlight }} />
        </Panel>
      )}

      <Panel icon={Upload} tone="slate" title="Upload a version" description="Install a version built and signed on the owner's computer (npm run release:zip). Only zips signed with the owner's release key are accepted, so a stolen admin sign-in alone cannot change the site.">
        {!signingKey ? (
          <p className="text-[14px] text-muted">
            No release signing key is set up yet. On the owner&apos;s Mac run <code className="font-mono text-[13px]">npm run release:zip -- --init</code> and commit <code className="font-mono text-[13px]">scripts/release-public-key.mjs</code> (docs/UPDATES.md, &quot;Install from a zip&quot;).
          </p>
        ) : isOwner ? (
          <ReleaseUpload />
        ) : (
          <p className="text-[14px] text-muted">Only the owner can upload, install or restore a version.</p>
        )}
        {dryRun && <p className="text-[13px] text-muted">Dry run (UPDATES_DRY_RUN=1): every check runs, but Install and Restore do not start the deploy workflow.</p>}
      </Panel>

      <div id="versions" />
      <Panel icon={Package} tone="slate" title={`Uploaded versions (last 30 days)`} description="The current and the previous installed version are always kept. Restore puts an earlier version back.">
        <p className={notice.warn}>
          Database changes are not undone by themselves. Each install backs up the database before its migrations; to go back to the old data, restore that version&apos;s backup by hand (docs/UPDATES.md).
        </p>
        {releases.length === 0 ? (
          <EmptyState icon={Package} title="No uploaded versions yet." />
        ) : (
          <ul className="flex flex-col gap-2">
            {releases.map((r) => {
              const st = RELEASE_STATUS[r.status] ?? { label: r.status, tone: "muted" as PillTone };
              return (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-line p-4">
                  <div className="flex min-w-0 flex-col gap-1 text-[14px]">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {r.version} <StatusPill tone={st.tone} dot>{st.label}</StatusPill>
                    </p>
                    <p className="text-[13px] text-muted">
                      Uploaded {dateTime(r.createdAt)} by {r.uploadedBy}
                      {r.installedAt && (
                        <>
                          {" "}· installed {dateTime(r.installedAt)}
                          {r.installRequestedBy ? ` by ${r.installRequestedBy}` : ""}
                        </>
                      )}
                    </p>
                    {r.notes && <p className="whitespace-pre-wrap break-words">{r.notes}</p>}
                    <details className="text-[12.5px] text-muted">
                      <summary className="cursor-pointer">Technical details</summary>
                      <p className="mt-1">
                        Commit <code className="font-mono">{r.commit.slice(0, 7)}</code>
                        {r.cloudflareVersionId ? <> · Cloudflare version <code className="font-mono">{r.cloudflareVersionId}</code></> : null} · Zip: {r.zipPath ? <code className="font-mono">releases/{r.zipPath}</code> : "removed after 30 days"} · Backup: {r.backupPath ? <code className="font-mono">releases/{r.backupPath}</code> : r.installedAt ? "removed after 30 days" : "taken at install"}
                      </p>
                    </details>
                    {r.error && <p className="text-[13px] text-danger">{r.error}</p>}
                  </div>
                  {isOwner && signingKey && (
                    <div className="flex gap-2">
                      {(r.status === "verified" || r.status === "failed") && r.zipPath && (
                        <ConfirmButton action={installReleaseAction} fields={{ id: r.id }} label={`Install ${r.version}`} variant="primary" title={`Install ${r.version}?`} description="GitHub checks the zip and its signature again with the key on main, backs up the database, runs the migrations, then builds and deploys. A failed build or migration leaves the live site as it is. Audited." confirmLabel="Install">
                          <Field label={`Type ${r.version} to confirm`} required>
                            <Input name="typed" autoComplete="off" required placeholder={r.version} />
                          </Field>
                        </ConfirmButton>
                      )}
                      {r.status === "superseded" && (r.cloudflareVersionId || r.zipPath) && (
                        <ConfirmButton action={restoreReleaseAction} fields={{ id: r.id }} label="Restore" title={`Restore ${r.version}?`} description={`${r.cloudflareVersionId ? "Cloudflare switches back to this version within a minute." : "This version's zip is installed again."} Database changes since are not undone: the old code must work with today's database, or restore the backup by hand. Audited.`} confirmLabel="Restore">
                          <Field label={`Type ${r.version} to confirm`} required>
                            <Input name="typed" autoComplete="off" required placeholder={r.version} />
                          </Field>
                        </ConfirmButton>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {s.connected && (
        <ExpandCard icon={Undo2} tone="red" title="Roll back" summary={`Puts the previous ${host.runtime} version back, when an update breaks the site.`}>
          <div className="flex flex-col gap-3">
            <p className="text-[14px] text-muted">
              Only the {host.runtime} code is rolled back. <strong className="text-text">Database migrations are not undone:</strong> if the update changed the database, the old code must still work with the new tables, or you need a manual migration back.
              {docsUrl && (
                <>
                  {" "}Read{" "}
                  <a href={docsUrl} target="_blank" rel="noreferrer noopener" className="underline">
                    docs/UPDATES.md
                  </a>{" "}
                  first.
                </>
              )}
            </p>
            <div>
              <ConfirmButton action={rollbackAction} fields={{}} label="Roll back to the previous version" variant="outline" title={`Roll back the ${host.runtime}?`} description={`${host.rollback} Database migrations stay as they are. The request is written to the audit log.`} confirmLabel="Roll back">
                <Field label="Reason" hint="Saved in the audit log." required>
                  <Textarea name="reason" rows={2} minLength={3} maxLength={200} required />
                </Field>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="confirm" required className="mt-1 size-4" />
                  <span>I understand that database migrations are not rolled back and that the previous version must work with the current database.</span>
                </label>
              </ConfirmButton>
            </div>
          </div>
        </ExpandCard>
      )}
    </>
  );
}
