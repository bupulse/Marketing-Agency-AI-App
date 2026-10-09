# Updates from the admin console (`/admin/settings/updates`)

The Updates page shows the version BuPulse is running, the newest release on GitHub with its notes, and the last deploys. **Install update** and **Roll back** start the official deploy workflow on GitHub Actions (`.github/workflows/deploy.yml`); the console never uploads code. Both need the admin sign-in with an authenticator code (AAL2), a second confirmation in the dialog, and are written to the audit log (`install_update`, `rollback_deploy`). Jarvis can read the same status with `get_update_status`, but cannot install or roll back.

## How a release works

1. Change `"version"` in `package.json`, commit, and push to `main`. (Every push to `main` still deploys by itself, as before; the Updates page is for choosing *which* version runs.)
2. On GitHub, make a release: Releases, Draft a new release, tag `v1.1.0` on `main`, write the notes, Publish. The notes appear on the Updates page as plain text (markdown headings, paragraphs and bullets; no HTML).
3. The page compares the release's version with the running one (`package.json` version and the commit SHA, both baked in at build time by `next.config.ts`; a local `next dev` shows `local`) and offers **Install 1.1.0**.
4. The admin types the version in the dialog. BuPulse checks that no deploy is queued or running, allows one start per minute, then calls GitHub's `workflow_dispatch` with `ref` = the release tag (or a commit SHA when the repository has no releases or tags), `action: deploy`, `environment: production`.
5. The run shows in **Deploys** within a few seconds; the list refreshes every 10 seconds until it finishes, then the page reloads. If the `production` environment has required reviewers, the run waits for approval on GitHub (the status reads "Waiting for approval").

What the workflow does for a deploy: check out the ref, `npm ci`, `prisma generate`, **`prisma migrate deploy`** (a failed migration stops everything), then `opennextjs-cloudflare build` and `deploy` with `BUILD_SHA` set to the commit.

## Rollback

**Roll back** starts the same workflow with `action: rollback`, which runs `npx wrangler rollback --yes` and puts the previous Worker version back (Cloudflare keeps the last versions; traffic switches within about a minute). Then the Updates page shows the old version again.

**Database migrations are not rolled back.** `prisma migrate deploy` only goes forward. If the update added a migration, the previous code keeps running against the newer schema; that is fine for additive changes (new tables, new nullable columns), but a migration that renamed or dropped something the old code uses will break it. Before such an update, take a Supabase backup (Database, Backups, or `pg_dump` with `DIRECT_URL`) and know how you would restore it. To undo a migration by hand, write a reverse SQL migration and deploy it as a new version.

Rolling back twice returns to the version before the first rollback (wrangler swaps the active version with the previous one). To go further back, use the Cloudflare dashboard (Workers, bupulse, Deployments) or install an older release from the page.

## What the owner sets up (once)

GitHub (Settings of the repository):

- **Secrets and variables, Actions:** secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DIRECT_URL`; variables `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the same ones `docs/DEPLOY.md` lists).
- **Environments:** create `production`. Supabase Free has no backup API the workflow could check, so the safety step is a person: add yourself under *Required reviewers*. Every deploy (also a push to `main`) then waits until you approve it on GitHub, which is the moment to take a backup. Leave reviewers empty if you prefer deploys to run straight away.
- **Fine-grained personal access token** (Settings, Developer settings, Personal access tokens, Fine-grained): only this repository; permissions *Actions: Read and write* and *Contents: Read* (Metadata is added by itself). Set an expiry and put a reminder in the calendar; when it expires the page says "GitHub refused the token (401)".

Cloudflare (runtime environment of the Worker):

```
npx wrangler secret put GITHUB_REPO     # owner/name, e.g. bupulse/bupulse
npx wrangler secret put GITHUB_TOKEN    # the fine-grained token
```

For local development add the same two lines to `.env` (see `.env.example`). Without them the page shows "Not connected" with these steps; everything else in the console works as before.

## Safety rules

- Server actions re-check the admin (allow-listed email, verified, AAL2) on every call, not just the layout.
- One run at a time: the page refuses while a run is queued, waiting or in progress, and allows one start per minute (so a double click cannot start two). The workflow's `concurrency: deploy-production` group is the second guard on GitHub's side.
- The ref is validated (tag or SHA characters only). The workflow file is always read from `main`; the ref only chooses what is checked out and built.
- Release notes are rendered as text blocks from React elements; GitHub markdown or HTML never reaches the page as HTML.
- Nothing from GitHub is stored. The token is only ever sent to `api.github.com` and never appears in errors, the audit log or tool answers.

## Checking by hand

```
# Is the token right? (expects the repository's JSON)
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/repos/$GITHUB_REPO | head -5
# Last runs of the deploy workflow
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" "https://api.github.com/repos/$GITHUB_REPO/actions/workflows/deploy.yml/runs?per_page=3"
```

The same workflow can be started from GitHub's Actions tab (Run workflow) with the same inputs; those runs also appear in the console.
