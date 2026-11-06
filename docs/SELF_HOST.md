# Self-hosting bupulse.com (Mac now, the home Windows 11 Pro PC next)

Owner decision, 3 November 2026: Netlify's free credits ran out until 13 November and there is no money for paid
hosting (Netlify Personal $9/month, Cloudflare Workers Paid $5/month, or Google Cloud Run's $30 non-refundable
prepayment). So bupulse.com runs on one of the owner's own computers behind a free Cloudflare Tunnel, the same way
test.bupulse.com has run from the Mac. No port is opened on the router: the tunnel connects out to Cloudflare.

**Trade-off:** the site is down whenever that computer sleeps, restarts, loses power or loses internet. Use a computer
that stays on (an always-on desktop is better than a laptop) and, ideally, a UPS.

## What runs

| Piece | What it does | File |
|---|---|---|
| Production server | `next start -p 3002` of a production build, with the production settings read from Netlify at each start and passed in memory only (never written to disk) | `scripts/self-host/start-server.mjs` |
| Cloudflare tunnel `bupulse-prod` | bupulse.com and www.bupulse.com → localhost:3002 | `scripts/self-host/cloudflared-bupulse-prod.yml` |
| Scheduled jobs | every minute `POST /api/cron/tick` with this computer's own `CRON_SECRET` (runs the routes due that UTC minute, `lib/cron/tick.ts`) | `scripts/self-host/cron-loop.sh` |
| Switch watcher | waits until bupulse.com is no longer answered by Netlify, then starts the job loop once | `scripts/self-host/switch-watcher.sh` |

`CRON_SECRET` is the computer's own (Mac: Keychain item "BuPulse production Mac cron"), different from Netlify's, so
Netlify's old scheduled functions, which call https://bupulse.com, are refused once DNS points at the tunnel: the jobs
never run twice.

## The Mac (3 November 2026, running)

- Code: `~/BuPulse-deploy` (detached worktree of the pushed `main`), built with `next build` and production settings.
- Logs and PIDs: `~/bupulse-prod/` (`server.log`, `tunnel.log`, `cron.log`, `switch.log`, `pids.txt`). Stop only by
  the exact PIDs in `pids.txt`.
- Start again after a restart: `node ~/bupulse-prod/start-server.mjs`, then
  `nohup cloudflared tunnel --no-autoupdate --config ~/.cloudflared/bupulse-prod.yml run bupulse-prod &`, then
  `nohup ~/bupulse-prod/cron-loop.sh &` (once DNS points at the tunnel).
- **The one manual step (owner, Cloudflare dashboard, DNS for bupulse.com):** delete the `A` record `bupulse.com →
  75.2.60.5` (Netlify) and the `www` record, then add `CNAME bupulse.com → cf9eb6ae-8290-4e87-8c8e-fc6e0c3375d0.cfargotunnel.com`
  and `CNAME www → the same`, both **Proxied** (orange cloud). Or, on the Mac:
  `cloudflared tunnel route dns --overwrite-dns bupulse-prod bupulse.com` and the same for `www.bupulse.com`.
  Email records (MX, SPF, DKIM, DMARC, Resend) stay untouched.
- Going back to Netlify (e.g. 13 November): restore the `A` record to `75.2.60.5` and `www`, deploy from
  `~/BuPulse-deploy` with `netlify deploy --no-build --prod --dir .netlify/static` after a `netlify build --context production`,
  and stop the Mac server, tunnel and job loop by their PIDs.

## The home Windows 11 Pro PC (next)

Yes, it can host bupulse.com, and it is a good free option if it stays on. Scripts: `scripts/self-host/windows/`
(not yet run on a real Windows PC when written, 4 November 2026):

| File | What it does |
|---|---|
| `install.ps1` | keeps the PC awake on mains power, creates `%USERPROFILE%\bupulse-prod` (logs and this PC's own `cron-secret.txt`, readable by that user only), `npm ci`, `netlify link` to the site, builds, writes `%USERPROFILE%\.cloudflared\bupulse-prod.yml`, and registers the start-at-boot tasks "BuPulse server", "BuPulse tunnel" and "BuPulse jobs" (S4U: they run without anyone signed in). "BuPulse jobs" is registered disabled. |
| `server.mjs` | `build` (prisma generate + next build) or `start` (`next start -H 127.0.0.1 -p 3002`), with Netlify's production settings in memory only |
| `cron-loop.ps1` | every 60 s `POST /api/cron/tick` with this PC's secret |

Order (the owner, with remote control):

1. Install Node.js 24 LTS, Git and cloudflared: `winget install OpenJS.NodeJS.LTS`, `winget install Git.Git`, `winget install Cloudflare.cloudflared` (then open a new PowerShell).
2. `git clone https://github.com/bupulse/Marketing-Agency-AI-App.git $env:USERPROFILE\BuPulse` (PowerShell).
3. `npx -y netlify-cli@27.12.0 login` (office@bupulse.com), `cloudflared tunnel login` (bupulse.com zone), then
   `cloudflared tunnel token --cred-file $env:USERPROFILE\.cloudflared\cf9eb6ae-8290-4e87-8c8e-fc6e0c3375d0.json bupulse-prod`.
4. Administrator PowerShell in the repo: `powershell -ExecutionPolicy Bypass -File scripts\self-host\windows\install.ps1`.
5. Check http://localhost:3002/api/status, then `Start-ScheduledTask "BuPulse tunnel"`: the tunnel now has two
   connectors (Mac and PC) and Cloudflare uses both; the database is shared, so that is safe.
6. On the Mac, stop the job loop, tunnel and server by their PIDs (`~/bupulse-prod/pids.txt`), then on the PC
   `Enable-ScheduledTask "BuPulse jobs"; Start-ScheduledTask "BuPulse jobs"`. Never run the jobs on both.

Updating the PC later (the repo is D:\BuPulse on the PC), in an administrator PowerShell:
`powershell -ExecutionPolicy Bypass -File D:\BuPulse\scripts\self-host\windows\update.ps1`. It pulls, stops the
server task AND the `next start` still listening on port 3002 (Stop-ScheduledTask alone leaves it running, so the old
version stays live), builds, starts the task and waits for /api/status.

Remote control: Chrome Remote Desktop (free, works from outside the home network without opening a port).
Windows 11 Pro's own Remote Desktop needs the PC reachable, so it suits the home network only.
