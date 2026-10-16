# Updates from the admin console (`/admin/settings/updates`)

The Updates page shows the version BuPulse is running, the newest release on GitHub with its notes, and the last deploys. **Install update** and **Roll back** start the official deploy workflow on GitHub Actions (`.github/workflows/deploy.yml` on Cloudflare, `.github/workflows/deploy-netlify.yml` on Netlify; the console picks the workflow of the host it runs on, and `DEPLOY_TARGET=cloudflare|netlify` in the app's environment overrides it, `lib/admin/deploy-host.ts`); the console never uploads code of its own: the only code it installs is a zip the owner built and signed (see *Install from a zip*). Both need the admin sign-in with an authenticator code (AAL2), a second confirmation in the dialog, and are written to the audit log (`install_update`, `rollback_deploy`). Jarvis can read the same status with `get_update_status`, but cannot install or roll back.

## How a release works

1. Change `"version"` in `package.json`, commit, and push to `main`. (Every push to `main` still deploys by itself, as before; the Updates page is for choosing *which* version runs.)
2. On GitHub, make a release: Releases, Draft a new release, tag `v1.1.0` on `main`, write the notes, Publish. The notes appear on the Updates page as plain text (markdown headings, paragraphs and bullets; no HTML).
3. The page compares the release's version with the running one (`package.json` version and the commit SHA, both baked in at build time by `next.config.ts`; a local `next dev` shows `local`) and offers **Install 1.1.0**.
4. The admin types the version in the dialog. BuPulse checks that no deploy is queued or running, allows one start per minute, checks the ref (see *Which refs can be installed* below), then calls GitHub's `workflow_dispatch` with `ref` = the release tag (or a commit SHA when the repository has no releases or tags), `action: deploy`, `environment: production`.
5. The run shows in **Deploys** within a few seconds; the list refreshes every 10 seconds until it finishes, then the page reloads. If the `production` environment has required reviewers, the run waits for approval on GitHub (the status reads "Waiting for approval").

What the workflow does for a deploy: check out `main`, check the ref again (format, and that it is on `main`'s history), check it out, check the variables (`scripts/check-env.mjs --build` and `--cloudflare`: names only), `npm ci`, `prisma generate`, **`prisma migrate deploy`** (a failed migration stops everything), then the Workers build (`scripts/cf-build.mjs`) and `opennextjs-cloudflare deploy` with `BUILD_SHA` set to the commit.

## Rollback

**Roll back** starts the same workflow with `action: rollback`. On Cloudflare it runs `npx wrangler rollback --yes` and puts the previous Worker version back (Cloudflare keeps the last versions; traffic switches within about a minute). On Netlify it runs `scripts/netlify-rollback.mjs`, which restores the production deploy before the live one through Netlify's API (free, live within seconds; each rollback goes one deploy further back, `docs/DEPLOY_NETLIFY.md`). Then the Updates page shows the old version again.

**Database migrations are not rolled back.** `prisma migrate deploy` only goes forward. If the update added a migration, the previous code keeps running against the newer schema; that is fine for additive changes (new tables, new nullable columns), but a migration that renamed or dropped something the old code uses will break it. Before such an update, take a Supabase backup (Database, Backups, or `pg_dump` with `DIRECT_URL`) and know how you would restore it. To undo a migration by hand, write a reverse SQL migration and deploy it as a new version.

Rolling back twice returns to the version before the first rollback (wrangler swaps the active version with the previous one). To go further back, use the Cloudflare dashboard (Workers, bupulse, Deployments) or install an older release from the page.

## Install from a zip (signed by the owner)

A version can also be installed from a zip: **Settings, Updates, Upload a version**. The zip is the source at one
commit, built and **signed on the owner's computer**; the console and the deploy workflow both refuse any zip not
signed with the owner's release key, so a stolen admin sign-in alone cannot change the site. Only the owner
(`ADMIN_EMAILS`, with the authenticator code) can upload, install or restore; staff never can, Jarvis never can.

### One-time setup (owner)

1. **The signing key**, on your Mac, in the repository:
   ```
   npm run release:zip -- --init
   ```
   It creates an Ed25519 key, keeps the private half in the macOS Keychain (item "BuPulse release signing key";
   never in a file, never printed) and writes the public half into `scripts/release-public-key.mjs`, which it prints.
   Commit and push that file to `main`: the console and the workflow read the key from there. (Instead, or as well,
   the public key can be put in the variable `RELEASE_PUBLIC_KEY`: in the app's environment and as a GitHub
   `production` environment variable. If both are set they must be the same key, or every install is refused.)
   Back the Keychain item up (it travels with iCloud Keychain, or export it): without it no new zip can be signed;
   a new key means committing a new public key first.
2. **The bucket**: migration `20261019130000_release_versions` creates the private Storage bucket `releases`
   (50 MB per file, the free plan's limit) and the `ReleaseVersion` table. Nothing else to do in Supabase.
3. **GitHub, environment `production`**: add the secret `SUPABASE_SECRET_KEY` (the workflow downloads the zip and
   uploads the database backup with it). `DIRECT_URL`, `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` (or the
   Netlify ones) are already there for normal deploys. `GITHUB_REPO` and `GITHUB_TOKEN` as above.
4. **The test machine** may set `UPDATES_DRY_RUN=1`: every check runs and is audited, but Install and Restore do not
   start the workflow.

### Installing a version

1. On your Mac, with the change committed: `npm run release:zip`. It writes `dist/release/bupulse-<version>.zip` (the
   tracked files at HEAD only: never `node_modules`, `.next` or `.env`; a tracked `.env` or private key stops it) and
   `bupulse-<version>.zip.sig` (the manifest: version, commit, sha256, size, created, and its signature).
2. Settings, Updates, **Upload a version**: choose both files and press Upload and check. The zip goes straight to
   the private bucket (a signed upload address, never through the app server); the server then reads it once as a
   stream and checks the signature, the sha256 and size against the signed manifest, and every path in the zip (no
   `..`, no absolute path, no symlink, nothing encrypted, the expected files there). A zip that fails is deleted.
3. The version appears under **Versions** as "Verified". **Install**, type the version, confirm. The workflow
   (`deploy-zip`) checks out `main`, verifies the zip and its signature again with main's key and the sha256 the
   console checked, unpacks it safely, then runs the usual steps on it: check-env, `npm ci`, `prisma generate`, the
   build, **a backup of the database** (`pg_dump` of the `public` schema into `releases/backups/`, kept 30 days),
   `prisma migrate deploy`, and the deploy. A failed check, build or migration stops before the deploy step: the live
   site stays as it was and the version shows "Failed".
4. When it has finished, the version shows "Running" with its Cloudflare version id and the backup's path.

### Restore and keeping versions

Every uploaded version stays listed for **30 days**, with its zip and its backup. **Restore** puts an earlier
installed version back: on Cloudflare it deploys that Worker version again (`wrangler versions deploy <id>`, no
build); if Cloudflare no longer keeps it, or on Netlify, its zip is installed again. The daily clean-up (the
`media-cleanup` cron) deletes zips and backups older than 30 days, but always keeps the current and the previous
installed version.

**Database changes are not undone.** A restore only changes the code. To go back to the data as it was before an
install, restore that install's backup by hand, for example:

```
# download releases/backups/<file>.dump from Supabase Storage, then
pg_restore --clean --if-exists --no-owner --schema=public -d "$DIRECT_URL" <file>.dump
```

Test it on the test project first; everything written after the backup is lost.

## What the owner sets up (once)

GitHub (Settings of the repository):

- **Environments:** create `production`. Supabase Free has no backup API the workflow could check, so the safety step is a person: add yourself under *Required reviewers*. Every deploy (also a push to `main`) then waits until you approve it on GitHub, which is the moment to take a backup. Leave reviewers empty if you prefer deploys to run straight away.
- **Environments, `production`:** put the secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DIRECT_URL` here as **environment secrets** (not repository secrets), and the variables `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as environment variables (the same ones `docs/DEPLOY.md` lists). Then delete any repository-level copies (Settings, Secrets and variables, Actions, Repository secrets). Environment secrets are only handed to jobs that run in `production`, so a workflow on another branch or in a pull request cannot read the database URL or the Cloudflare token. (`CRON_SECRET` and `GEMINI_API_KEY`, used by the scheduled and CI workflows, stay repository secrets; no other workflow uses the three deploy secrets.)
- Under the same environment, **Deployment branches and tags:** choose *Selected branches and tags* and add `main` only (and, if you deploy tags by pushing them, the rule `v*`). A workflow started from any other branch then cannot enter `production` at all.
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
- The ref is validated twice, see below. The workflow file is always read from `main`; the ref only chooses what is checked out and built.
- Release notes are rendered as text blocks from React elements; GitHub markdown or HTML never reaches the page as HTML.
- Nothing from GitHub is stored. The token is only ever sent to `api.github.com` and never appears in errors, the audit log or tool answers.

## Which refs can be installed

Only two shapes are accepted, by the console (`lib/admin/updates.ts`) and again by the workflow (`deploy.yml`, before any of the target's code runs):

- a release tag `vX.Y.Z` (`^v\d+\.\d+\.\d+$`, for example `v1.2.0`; `1.2.0`, `v1.2` or `v1.2.0-rc1` are refused), or
- a full 40-character lowercase commit SHA.

The target must be on `main`'s history. The console asks GitHub's compare API (`/compare/<sha>...main` must say `ahead` or `identical`); the workflow fetches `main` and runs `git merge-base --is-ancestor <commit> origin/main` (for a tag, on the commit it points to). A branch name, a short SHA, or a commit that only exists on another branch or a fork never gets the production secrets. Name release tags `vX.Y.Z` and create them on `main`; a release whose tag has another shape shows on the page but cannot be installed (cut a new `vX.Y.Z` tag on the same commit).

The workflow's `environment` input is a choice with `production` as the only option, and both jobs run in `production` whatever is passed.

## Checking by hand

```
# Is the token right? (expects the repository's JSON)
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/repos/$GITHUB_REPO | head -5
# Last runs of the deploy workflow
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" "https://api.github.com/repos/$GITHUB_REPO/actions/workflows/deploy.yml/runs?per_page=3"
```

The same workflow can be started from GitHub's Actions tab (Run workflow) with the same inputs; those runs also appear in the console.
