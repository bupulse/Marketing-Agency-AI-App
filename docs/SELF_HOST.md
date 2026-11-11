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
| `cron-loop.ps1` | every 60 s `POST /api/cron/tick` with this PC's secret, and on its own thread the PC's heartbeat (below) |

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

Tools with the production settings (in memory), on the PC: `node scripts/self-host/windows/server.mjs tool <name> [args]`
runs `scripts/self-host/tools/<name>.mjs`. `wipe-test-clients` (6 November 2026) lists every account except ADMIN_EMAILS
and staff, and with `--yes <count>` writes a full backup to %USERPROFILE%\bupulse-prod\backups, marks them due and
asks the running server's purge (lib/account-deletion.ts) to erase them.

**Heartbeat (9 November 2026).** Every minute `cron-loop.ps1` also posts this PC's state to
`POST http://127.0.0.1:3002/api/monitor/heartbeat` with the same secret (`cron-secret.txt`): computer name, Windows
version, last restart, CPU %, memory used/total, free/total space on the Windows drive and on the drive holding the repo,
the state of the "BuPulse server", "BuPulse tunnel" and "BuPulse jobs" tasks, whether port 3002 is listening, and the
node and cloudflared versions (read every 6 hours). The support app's Server page shows it, and says "not reporting"
after 3 minutes without one (docs/SUPPORT_DASHBOARD.md, "Server monitoring"). It runs on its own PowerShell thread with
its own try/catch, so a slow tick never delays it and a failed heartbeat never stops the tick. Its failures go to
`%USERPROFILE%\bupulse-prod\heartbeat.log`, one line when it starts failing and one when it works again. The loop
reads the script only when it starts, so `update.ps1` now restarts the "BuPulse jobs" task at the end (when it is not
switched off); after updating by hand: `Stop-ScheduledTask "BuPulse jobs"; Start-ScheduledTask "BuPulse jobs"`.
The Mac's `cron-loop.sh` sends no heartbeat (the Mac copy is off).

The site is also checked from outside every 5 minutes by GitHub Actions (`.github/workflows/uptime.yml`), with its own
secret UPTIME_SECRET, because GitHub cannot hold this PC's cron secret (docs/SUPPORT_DASHBOARD.md, "What the owner must set").

The tick also runs /api/cron/purge-accounts (03:17) and /api/cron/social-refresh (04:43): GitHub Actions' calls carry the
old CRON_SECRET, which the PC refuses.

Since 9 November 2026 the PC build runs `prisma migrate deploy` first (server.mjs build), as the Netlify deploy workflow
did, so a new version's tables and columns reach the production database on the next update. The tunnel's hostnames
(bupulse.com, www, support.bupulse.com, and since 11 November marketing.bupulse.com and admin.bupulse.com: docs/HOSTS.md)
are in scripts/self-host/windows/tunnel-config.ps1; update.ps1 rewrites the config and restarts the tunnel task when
they change.

Remote control: Chrome Remote Desktop (free, works from outside the home network without opening a port).
Windows 11 Pro's own Remote Desktop needs the PC reachable, so it suits the home network only.

## Videos made on the PC (render worker, 11 November 2026)

Owner decision: pictures and reels are made on the server right away, even when nobody has the page open. Images are
drawn by the server itself; videos (the daily slideshow reel with voice-over and library music, Instagram and TikTok
reels, every pending content video) need a browser engine, so the PC runs a **render worker** beside the server:

- **What it is:** `scripts/video-robot/pc-worker.mjs`, the GitHub video robot (`scripts/video-robot/robot.mjs`,
  docs/VIDEO_ROBOT.md) run as a loop on the PC. Every 10 seconds it asks `http://127.0.0.1:3002/api/robot/videos/peek`
  (quietly, no heartbeat row each time) and, when videos wait, claims them, renders each in **headless Microsoft
  Edge** (Google Chrome if Edge is missing) with the same renderer as the owner's browser (WebCodecs H.264 MP4, voice-over
  and music mixed by `lib/voice/mix.ts`), uploads the file to its reserved URL and confirms it. A video planned at 09:00
  is ready around 09:01. The worker leaves the idle heartbeat every 15 minutes and reports each run with `runner: "pc"`
  (Admin → Services, video robot card).
- **How it runs:** a fourth thread in `cron-loop.ps1` (the "BuPulse jobs" task) runs
  `node scripts\self-host\windows\server.mjs videos` in a loop. `server.mjs videos` reads the production settings like
  the other modes, then starts the worker with this PC's own environment plus only `ROBOT_APP_URL=http://127.0.0.1:3002`
  and `VIDEO_ROBOT_SECRET` (in memory; no database URL or other key reaches it). The worker exits after an hour and the
  thread starts a fresh one 15 seconds later (new code after an update, no slow memory leak). If it fails, it waits
  30 s, 1, 2, then up to 5 minutes and tries again. It never stops the tick, the heartbeat or the self-check: each has
  its own thread and its own try/catch.
- **Log:** `%USERPROFILE%\bupulse-prod\videos.log` (counts and fixed event names only, trimmed to its last 2,000 lines
  past 5 MB).
- **The screens:** `server.mjs` sets `BUPULSE_SERVER_RENDER=1` for the server, so a pending video says "Being made on
  our server, usually within 2 minutes" and the page looks again every 15 seconds (lib/visuals/robot.ts
  `serverRenderOn`). The loading ring shows while it is made (components/visuals/making-screen.tsx).
- **Fallback:** the GitHub video robot keeps running every 15 minutes against https://bupulse.com. The render lease means
  the PC and GitHub never make the same video; if the PC is off, GitHub makes them (slower), and after 3 failed robot
  renders the owner's browser can still make it.

### What the owner must install or change on the PC

1. **Nothing to install for the browser:** Microsoft Edge comes with Windows 10 and the worker uses it. (If Edge was
   removed: `winget install Google.Chrome`. Playwright's own browser download is not needed: `playwright-core` drives
   the installed Edge or Chrome.)
2. **The robot secret.** The server and the worker need the same `VIDEO_ROBOT_SECRET`:
   - if Netlify's production settings have `VIDEO_ROBOT_SECRET` (the GitHub robot's secret), nothing to do;
   - otherwise, in PowerShell on the PC (makes a random secret readable by this user only):
     `$s = -join ((48..57)+(97..122) | Get-Random -Count 40 | % {[char]$_}); Set-Content "$env:USERPROFILE\bupulse-prod\robot-secret.txt" $s; icacls "$env:USERPROFILE\bupulse-prod\robot-secret.txt" /inheritance:r /grant:r "$($env:USERNAME):(R,W)"`
     `server.mjs` uses it when Netlify has none. Then only the PC makes videos automatically (GitHub's robot keeps its
     own secret and is refused until the two match: set the same value as the GitHub secret VIDEO_ROBOT_SECRET and the
     variable ROBOT_APP_URL=https://bupulse.com to keep it as the fallback).
3. **Update and restart:** `update.ps1` (it rebuilds, restarts the server, and restarts the "BuPulse jobs" task, which
   starts the worker thread). After updating by hand: `Stop-ScheduledTask "BuPulse jobs"; Start-ScheduledTask "BuPulse jobs"`.
   Stopping the jobs task can leave a running worker for up to an hour; that is safe (the lease), or end it in Task
   Manager (`node.exe` running `pc-worker.mjs`).
4. **Check it:** after a Create post with a video, `Get-Content "$env:USERPROFILE\bupulse-prod\videos.log" -Tail 20`
   should show "Claimed: videos 1" and "Run finished: claimed 1, made 1, failed 0" within a minute or two.
   Self-test on the PC, no database: `node scripts\video-robot\self-test.mjs --worker` with `$env:ROBOT_CHROME_CHANNEL="msedge,chrome"`.

Cost: none (the PC's own CPU; a 15-second 1080x1920 reel takes about 20 to 40 seconds to render). The Mac's
`cron-loop.sh` has no render worker (the Mac copy is off).
