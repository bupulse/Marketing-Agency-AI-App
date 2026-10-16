# Install an update zip

This page explains how a new version of BuPulse gets onto the live site without the command line: the owner uploads a
signed zip in **Admin → Settings → Updates** and presses **Install**. GitHub then checks the zip again, backs up the
database, builds and publishes it. The zip is made and signed on the owner's Mac, with a key that never leaves the
macOS Keychain, so even someone who stole an admin sign-in cannot put their own code on the site. Every installed
version is kept for 30 days and can be put back with **Restore**.

**On this page**
- [The short version](#the-short-version)
- [One-time setup](#one-time-setup)
- [Step 1: make the zip (only after the owner says the update is good)](#step-1-make-the-zip-only-after-the-owner-says-the-update-is-good)
- [Step 2: upload and check](#step-2-upload-and-check)
- [Step 3: install](#step-3-install)
- [What is checked, and when](#what-is-checked-and-when)
- [Going back: Restore and Roll back](#going-back-restore-and-roll-back)
- [When something fails](#when-something-fails)
- [The other way: Install update from a GitHub release](#the-other-way-install-update-from-a-github-release)
- [For developers](#for-developers)

## The short version

1. The update is tested on the test site and the owner says it is good.
2. On the owner's Mac: `npm run release:zip`. Two files appear in `dist/release/`.
3. Admin → Settings → Updates → **Upload a version**: choose both files, press **Upload and check**.
4. The version shows **Verified, not installed**. Press **Install**, type the version number, confirm.
5. Wait until it shows **Running** (a few minutes). Done.

## One-time setup

Done once by the owner; already done if `scripts/release-public-key.mjs` holds a key.

1. **Make the signing key** on the owner's Mac, in the BuPulse folder:

   ```bash
   npm run release:zip -- --init
   ```

   It creates the key pair, keeps the private half in the macOS Keychain (item "BuPulse release signing key"; never in
   a file, never printed) and writes the public half into `scripts/release-public-key.mjs`. Commit and push that file
   to `main`. Back up the Keychain item (iCloud Keychain, or export it): without it no new zip can be signed.
2. **The storage bucket**: the migration `20261019130000_release_versions` creates the private `releases` bucket
   (50 MB per file) and the `ReleaseVersion` table. Nothing to do by hand.
3. **GitHub, environment `production`**: the secret `SUPABASE_SECRET_KEY` (the workflow downloads the zip and stores the
   backup with it), plus the usual deploy secrets (`DIRECT_URL`, and the Netlify or Cloudflare ones).
4. **The app's environment**: `GITHUB_REPO` (owner/name) and `GITHUB_TOKEN` (a fine-grained token for this repository
   only, *Actions: Read and write*, *Contents: Read*, with an expiry date in your calendar). Without them the page says
   "Not connected".
5. **Test machine only**: `UPDATES_DRY_RUN=1` runs every check but never starts the deploy.

## Step 1: make the zip (only after the owner says the update is good)

Rule: the zip is made **only after the owner has confirmed the update is tested and good**. Nobody uploads or installs
it without the owner's go-ahead.

1. Commit the change (the zip holds the last commit, `HEAD`; uncommitted changes are left out, with a warning).
2. Change `"version"` in `package.json` if this is a new version, and commit.
3. Run:

   ```bash
   npm run release:zip
   ```

4. It prints two files:
   - `dist/release/bupulse-<version>.zip`: the source code at that commit (only files tracked by git: never
     `node_modules`, `.next` or `.env`);
   - `dist/release/bupulse-<version>.zip.sig`: the signed label (version, commit, sha256 fingerprint, size, date and the
     signature).

It stops if a secret file is tracked by git (an `.env` other than `.env.example`, or a private key), if the zip is over
50 MB, or if the Keychain key does not match the public key in the repository.

## Step 2: upload and check

1. Sign in to the admin console as the **owner** (an address in `ADMIN_EMAILS`, with the authenticator code). Staff
   and Jarvis can never upload, install or restore.
2. Admin → Settings → **Updates** → **Upload a version**.
3. Choose the `.zip` and the `.zip.sig` made together, add a note if you like, press **Upload and check**.
4. The zip goes straight to the private `releases` bucket (never through the app server). The server then reads it once
   and checks it (see below). A zip that fails is deleted and the reason is shown.
5. The version appears under **Versions** as **Verified, not installed**.

## Step 3: install

1. Next to the version, press **Install**, type the version exactly as shown, confirm.
2. The version shows **Installing**. GitHub Actions starts the host's deploy workflow (`deploy-netlify.yml` or
   `deploy.yml`) with `action: deploy-zip`. If the `production` environment has required reviewers, approve the run on
   GitHub.
3. The workflow: checks the zip again with the key on `main`, unpacks it safely, checks the keys, installs, builds,
   **backs up the database** (into `releases/backups/`, kept 30 days), runs the database migrations, publishes.
4. When it is done the version shows **Running**, with the backup's path (and on Cloudflare the Worker version id). The
   version that ran before shows **Installed before**.

A deploy on Netlify costs 15 of the month's 300 free credits.

## What is checked, and when

| Check | In the console (upload) | In the workflow (install) |
|---|---|---|
| The signature matches the owner's release key | yes | yes, again, with the key on `main` |
| The zip's size and sha256 match the signed label | yes | yes, and the sha256 must equal the one the console checked |
| Every path in the zip is safe: no `..`, no absolute path, no symbolic link, nothing encrypted | yes | yes, before and after unpacking |
| The expected files are there: `package.json`, `package-lock.json`, `next.config.ts`, `prisma/schema.prisma` | yes | yes |
| Only the owner, signed in with the authenticator (AAL2) | yes | |
| No other deploy queued or running; at most 10 uploads and 20 checks an hour | yes | one deploy at a time (`concurrency`) |
| Keys present (`scripts/check-env.mjs`) | | yes |
| Build and migrations succeed | | yes; a failure stops before publishing |

If the public key is in both `scripts/release-public-key.mjs` and `RELEASE_PUBLIC_KEY`, they must be the same key, or
every install is refused.

## Going back: Restore and Roll back

**Restore** (Versions list, next to a version marked **Installed before**): puts that earlier version back. On
Cloudflare it switches to that Worker version again (no build). On Netlify, or when Cloudflare no longer keeps it, the
version's zip is installed again. Type the version and confirm.

**Roll back** (top of the page): starts the workflow with `action: rollback`. Netlify publishes the deploy before the
live one again (free, within seconds); Cloudflare runs `wrangler rollback` (about a minute). Each Netlify rollback goes
one deploy further back.

**The database is never rolled back.** Restore and Roll back change only the code. Most updates only add tables and
columns, so older code keeps working. To get the data back as it was before an install, restore that install's backup
by hand (test it on the test project first; everything written after the backup is lost):

```bash
# download releases/backups/<file>.dump from Supabase Storage, then
pg_restore --clean --if-exists --no-owner --schema=public -d "$DIRECT_URL" <file>.dump
```

Versions stay listed for **30 days**. The daily clean-up job (`/api/cron/media-cleanup`) deletes older zips and backups,
but always keeps the current and the previous installed version.

## When something fails

| Message or state | What it means | What to do |
|---|---|---|
| "No release signing key is set up…" | The repository has no public key | `npm run release:zip -- --init`, commit `scripts/release-public-key.mjs`, deploy once the normal way |
| "The signature is not valid for the owner's release key…" | The zip was not signed with the owner's key, or the key changed | Make the zip again with `npm run release:zip` on the owner's Mac |
| "The zip is not the one that was signed (its size or sha256 differs)…" | The `.zip` and `.sig` are from different runs, or the zip was changed | Upload the two files made together |
| "This zip lacks …: it is not a BuPulse source release." | Wrong zip | Use the file from `dist/release/` |
| "Choose a zip of at most 50 MB." / "The zip is larger than 50 MB." | Too big | Remove large tracked files (videos, images) from git |
| "Storage did not give an upload address. Is the "releases" bucket there…?" | The migration that makes the bucket did not run | Deploy once the normal way so the migrations run |
| "Updates are not connected: set GITHUB_REPO and GITHUB_TOKEN" / "GitHub refused the token (401)" | Missing or expired GitHub token | Make a new fine-grained token, save it on the host |
| "A deploy is already running (run #…)" | One deploy at a time | Wait for it to finish |
| "Type the version exactly as shown (…) to confirm." | Typo | Type the version as shown |
| "Only the owner can upload, install or restore a version." | You are signed in as staff | Sign in as the owner |
| "This version's zip was removed after 30 days. Upload it again." | Too old | Make and upload it again |
| "Dry run: the workflow was not started (UPDATES_DRY_RUN=1)." | This is the test machine | Expected; nothing was deployed |
| Version shows **Failed** | A check, the build or a migration failed in the workflow. The live site is unchanged | Open the run on GitHub (Actions) or in Deploys on the Updates page, read the red step, fix, make a new zip |
| Version stays **Installing** for a long time | The run waits for your approval on GitHub, is queued, or was cancelled | Check the run in GitHub Actions; approve it, or start again once it has stopped |
| `release:zip: no signing key in the Keychain` | This Mac has no key | Use the owner's Mac, or restore the Keychain item |
| `release:zip: the Keychain key does not match scripts/release-public-key.mjs` | The key was replaced | Commit the matching public key first |

A failed migration after the backup step: the live code is unchanged, but check the database is not half-updated
(see [Troubleshooting](../troubleshooting.md#database-and-migrations)).

## The other way: Install update from a GitHub release

The top of the Updates page shows the version running now and the newest **GitHub release**. When the release is
newer, **Install <version>** deploys that release tag (`vX.Y.Z` on `main`) through the same workflow, with no zip. Only
a tag shaped `vX.Y.Z` or a full 40-character commit id that is on `main` can be installed; anything else is refused by
the console and again by the workflow. Details: `docs/UPDATES.md`.

## For developers

| Part | Files and functions |
|---|---|
| Page | `app/admin/(console)/(system)/settings/updates/page.tsx` (`RELEASE_STATUS` labels, `Versions`), `components/admin/release-upload.tsx` |
| Server actions | `app/admin/(console)/(system)/settings/updates/actions.ts`: `startReleaseUploadAction`, `verifyReleaseAction`, `installReleaseAction`, `restoreReleaseAction`, `installUpdateAction`, `rollbackAction` |
| Deploy runs list | `app/admin/(console)/(system)/settings/updates/runs/route.ts`, `listDeployRuns` in `lib/admin/updates.ts` |
| Zip logic | `lib/updates/releases.ts`: `assertOwner`, `releasePublicKey`, `startReleaseUpload`, `readZipStream`, `checkRelease`, `verifyUploadedRelease`, `installRelease`, `restoreRelease`, `listReleases`, `cleanupReleases`, `isDryRun`; constants `RELEASES_BUCKET`, `KEEP_DAYS`, `UPLOAD_RULE`, `VERIFY_RULE` |
| GitHub release path | `lib/admin/updates.ts`: `getUpdateStatus`, `installUpdate`, `rollbackDeploy`, `RELEASE_TAG`, `COMMIT_SHA`, `DISPATCH_RULE`; `lib/admin/github.ts`; host choice `deployHost` in `lib/admin/deploy-host.ts` |
| Shared signing code | `scripts/release-core.mjs` (`canonicalManifest`, `manifestProblem`, `parseSigFile`, `verifyManifest`, `resolvePublicKey`, `inspectZipDirectory`, `unsafeName`, `REQUIRED_FILES`, `RELEASE_MAX_BYTES`) |
| Making the zip | `scripts/release-zip.mjs` (`init`, `build`, `forbiddenTracked`; Ed25519 via WebCrypto, Keychain via `security`) |
| Workflow check | `scripts/verify-release.mjs`, run from `main`'s checkout before any of the zip's code |
| Workflows | `deploy-zip` and `restore` jobs in `.github/workflows/deploy.yml`; `deploy-zip` in `.github/workflows/deploy-netlify.yml` |
| Public key | `scripts/release-public-key.mjs` (`RELEASE_PUBLIC_KEY`), or the variable `RELEASE_PUBLIC_KEY` |
| Database | `ReleaseVersion` (`status`: verified → installing → installed or failed; superseded), migration `20261019130000_release_versions` |
| Audit | `writeAudit` (`lib/admin/audit.ts`) with `upload_release`, `install_release`, `restore_release`; GitHub-release installs are `install_update`, rollbacks `rollback_deploy` |
| Tests | `tests/updates/release.test.ts`, `tests/updates/release.db.test.ts` (database, opt-in) |
