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

Yes, it can host bupulse.com, and it is a good free option if it stays on. Setup (about an hour, with remote control):

1. **Never sleep:** Settings → System → Power: screen off is fine, *sleep: never*; BIOS "restore on AC power loss: on"
   if available. Windows Update → Advanced → active hours, so restarts happen at night.
2. **Install:** Node.js 24 LTS (nodejs.org), Git, and `cloudflared` (`winget install --id Cloudflare.cloudflared`).
3. **Code:** `git clone https://github.com/bupulse/Marketing-Agency-AI-App.git`, `npm ci`, `npx prisma generate`.
4. **Settings:** `npx netlify-cli login` once (office@bupulse.com), then a PowerShell version of `start-server.mjs`
   works as is (it is plain Node; only the Keychain line changes: use an environment variable set once with
   `setx BUPULSE_CRON_SECRET <random>` or Windows Credential Manager).
5. **Build and start:** `node scripts/self-host/start-server.mjs` (after `next build` with the production settings).
6. **Tunnel:** `cloudflared tunnel login`, then either move the `bupulse-prod` tunnel (copy its credentials JSON from the
   Mac's `~/.cloudflared/`) or create a new one, and install it as a Windows service: `cloudflared service install`.
7. **Start on boot:** Task Scheduler → "At startup" tasks for the server and the job loop (a PowerShell loop calling
   `Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3002/api/cron/tick -Headers @{Authorization="Bearer $env:BUPULSE_CRON_SECRET"}` every 60 s).
8. **Switch:** stop the Mac's tunnel by its PID; the DNS records already point at the tunnel, so whichever computer runs
   it serves bupulse.com.

Remote control: Windows 11 Pro has Remote Desktop built in (Settings → System → Remote Desktop), but it needs the PC to be
reachable; from outside the home network use Chrome Remote Desktop or Cloudflare's own access (Zero Trust, free for up
to 50 users) rather than opening a port.
