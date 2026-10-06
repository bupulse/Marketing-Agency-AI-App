# Deploying BuPulse

BuPulse runs on Cloudflare Workers (through OpenNext). The database is Supabase Postgres, reached through Cloudflare Hyperdrive. These steps are done once by the owner; after that GitHub deploys every push to `main`.

## 1. One-time Cloudflare setup

1. Log in: `npx wrangler login`
2. Create the Hyperdrive config. Use the Supabase **session pooler** connection string (Supabase: Connect, then Session pooler, port 5432), the same style as `DIRECT_URL`:

   ```
   npx wrangler hyperdrive create bupulse-db --connection-string="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
   ```

3. Copy the `id` it prints into `wrangler.jsonc`, replacing `TODO_HYPERDRIVE_CONFIG_ID`.
4. Run `npm run cf-typegen` after any change to `wrangler.jsonc`.

## 2. Runtime secrets (stored in Cloudflare, never in git)

Set each one with `npx wrangler secret put NAME` (it asks for the value):

| Name | What it is |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable (anon) key |
| `NEXT_PUBLIC_SITE_URL` | Public site URL, e.g. `https://bupulse.com` |
| `ENCRYPTION_KEY` | 32 random bytes, base64: `openssl rand -base64 32` |
| `AI_TEXT_PROVIDER` | `gemini` or `claude` |
| `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL` | Gemini settings |
| `ANTHROPIC_API_KEY`, `CLAUDE_TEXT_MODEL`, `CLAUDE_EFFORT` | Claude settings |

`DATABASE_URL` is not needed on Cloudflare: the app uses the Hyperdrive binding there.
The `NEXT_PUBLIC_*` values are also needed at build time (see the GitHub variables below), because Next.js bakes them into the browser code.

## 3. GitHub settings (Settings, Secrets and variables, Actions)

Secrets:

- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with the "Edit Cloudflare Workers" template
- `CLOUDFLARE_ACCOUNT_ID`: shown on the Cloudflare dashboard sidebar
- `DIRECT_URL`: Supabase direct/session connection string (port 5432), used to run migrations

Variables (not secret, they end up in the browser anyway):

- `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## 4. Deploying

- Automatic: every push to `main` runs `.github/workflows/deploy.yml`, which applies database migrations (`prisma migrate deploy`) and then deploys. If a migration fails, nothing is deployed.
- CI (`.github/workflows/ci.yml`) runs lint, type check, tests, build and the browser smoke test on every pull request.
- Manual, from your machine (needs `wrangler login` and a `.env` with the build-time values): `npm run deploy`
- Try the Workers build locally: `npm run preview`

## 5. Domains (later)

When ready, in `wrangler.jsonc` add:

```jsonc
"routes": [{ "pattern": "bupulse.com", "custom_domain": true }]
```

The domain's DNS must be on Cloudflare. For staging, create a second worker (copy `wrangler.jsonc` to an environment named `staging` with its own name, Hyperdrive config and `staging.bupulse.com` route) and deploy it with `--env staging`. Each environment has its own secrets (`wrangler secret put NAME --env staging`) and should point at the staging Supabase project.

## Known notes

- Bundle size: the Worker is about 4.7 MiB gzipped. The free Workers plan allows 3 MiB, so production needs the Workers Paid plan (10 MiB limit).
- `pg-cloudflare` is pinned to 1.3.0 in `package.json` (`overrides`) because 1.4.1 is published without the files the bundler needs. Remove the pin once a fixed version ships.
- `proxy.ts` runs as Node.js middleware, which OpenNext marks experimental on Cloudflare. Check sign-in and the `/dashboard` redirect on staging.

## Account deletion (30-day grace period)

Deleting an account locks it for 30 days; the owner can sign in and cancel. A daily GitHub Actions job (`.github/workflows/purge-accounts.yml`) calls `POST /api/cron/purge-accounts`, which erases accounts past the date, including their files in Storage. It needs two more secrets:

- `SUPABASE_SECRET_KEY`: Supabase, Project Settings, API keys, the secret key. Set it in Cloudflare (`wrangler secret put SUPABASE_SECRET_KEY`). Server only. Without it accounts are still erased but their Storage files are left behind.
- `CRON_SECRET`: any long random string (for example `openssl rand -base64 32`). Set the same value in Cloudflare and as a GitHub Actions secret.

You can run the job by hand from the Actions tab (Run workflow). `/api/cron` is not behind the sign-in redirect in `proxy.ts`; the route checks the bearer token itself.
