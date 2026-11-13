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
| `install.ps1` | keeps the PC awake on mains power, creates `%USERPROFILE%\bupulse-prod` (logs and this PC's own `cron-secret.txt`, readable by that user only), `npm ci`, `netlify link` to the site, builds, writes `%USERPROFILE%\.cloudflared\bupulse-prod.yml`, and sets up the supervisor (`admin-once.ps1`). Fresh installs only; it needs an administrator PowerShell. Until 13 November 2026 it registered three start-at-boot tasks instead ("BuPulse server", "BuPulse tunnel", "BuPulse jobs"). |
| `supervisor.mjs` | **since 13 November 2026**: runs the server, the tunnel and the jobs loop, starts each again when it stops, and sends the down watch's reports (see "Supervisor, down alert and missed jobs" below) |
| `setup-supervisor.ps1` | registers the per-user "BuPulse supervisor" task (at sign-in, checked every 5 minutes, hidden), **no administrator needed** |
| `admin-once.ps1` | **one time, administrator**: retires the three old tasks, registers "BuPulse supervisor at boot", runs `setup-supervisor.ps1` |
| `update.ps1` | pulls, builds and restarts: through the supervisor in a **normal** PowerShell, or the old tasks' way (administrator) when there is no supervisor yet; always restarts the site and keeps the previous build (`.next-prev`) |
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

Updating the PC later (the repo is C:\Users\WECPC015\BuPulse on the PC):
`powershell -ExecutionPolicy Bypass -File C:\Users\WECPC015\BuPulse\scripts\self-host\windows\update.ps1`. It picks
its way by itself:
- **with the supervisor** (after `admin-once.ps1`): a **normal** PowerShell. It pulls, asks the supervisor to stop the
  server (the `pause-server` file; the supervisor stops the exact process it started, with its `next start` child),
  builds, removes `pause-server` in a `finally` (so the site always comes back), waits for /api/status and restarts the
  jobs loop. If `supervisor.mjs` changed, it first checks the new file loads (`node --check` and `--self-test`) and only
  then asks for a fresh supervisor.
- **without it** (nothing answers on 127.0.0.1:3019 and no supervisor task is switched on): the old way, in an
  **administrator** PowerShell: Stop-ScheduledTask "BuPulse server", stop the process listening on port 3002 by its
  ID, build, `Start-ScheduledTask "BuPulse server"` in a `finally`, restart "BuPulse jobs". Those tasks were registered
  from an administrator PowerShell; Windows lets only administrators control them (that was the UAC prompt).
Both ways keep the previous build: `.next` is renamed `.next-prev` before the build (its cache moved back in). If the
build fails, is stopped with Ctrl+C or anything else goes wrong, the `finally` that starts the site again first puts it
back, by renames only (the failed build becomes `.next-failed-<time>`, delete it by hand later), so the site never starts
on a broken build. If `.next` cannot be renamed at all (a locked file), it says so and builds nothing. `.next-prev`
stays as a one-step rollback until the next update. The old way waits up to 5 minutes for the site (this PC takes about
3) and restarts "BuPulse jobs" even when the site is slow.

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
reads the script only when it starts, so `update.ps1` restarts the jobs loop at the end (since 13 November 2026 through
the supervisor: the `restart-jobs` file); after updating by hand:
`New-Item -ItemType File -Force $env:USERPROFILE\bupulse-prod\restart-jobs`. With the supervisor, the three "tasks" on
the Server page are its three pieces (from `supervisor-state.json`): Running, Waiting to start (restarting), Stopped
(paused for an update) or Switched off (jobs loop off). The Mac's `cron-loop.sh` sends no heartbeat (the Mac copy is off).

The site is also checked from outside every 5 minutes by GitHub Actions (`.github/workflows/uptime.yml`), with its own
secret UPTIME_SECRET, because GitHub cannot hold this PC's cron secret (docs/SUPPORT_DASHBOARD.md, "What the owner must set").

The tick also runs /api/cron/purge-accounts (03:17) and /api/cron/social-refresh (04:43): GitHub Actions' calls carry the
old CRON_SECRET, which the PC refuses.

Since 9 November 2026 the PC build runs `prisma migrate deploy` first (server.mjs build), as the Netlify deploy workflow
did, so a new version's tables and columns reach the production database on the next update. The tunnel's hostnames
(bupulse.com, www, support.bupulse.com, and since 11 November marketing.bupulse.com and admin.bupulse.com: docs/HOSTS.md)
are in scripts/self-host/windows/tunnel-config.ps1; update.ps1 rewrites the config and has the supervisor restart the
tunnel when they change.

Remote control: Chrome Remote Desktop (free, works from outside the home network without opening a port).
Windows 11 Pro's own Remote Desktop needs the PC reachable, so it suits the home network only.

## Supervisor, down alert and missed jobs (13 November 2026)

The owner was away and wanted the PC sturdier: the site and tunnel come back by themselves, updates without an
administrator, one message when the site is down, and no "overdue" jobs after a power cut.

### What the main session runs on Windows

Two phases, done separately. None of the lines types a secret.

**Phase A: the app update only (tonight, the old tasks stay).** The Telegram token reading, the partner faults on
Health, the catch-up of missed jobs and the watch endpoint (it waits for the supervisor). Down for a few minutes during
the build.

1. In the **administrator** PowerShell already open on the PC (the old tasks need it):
   ```
   cd C:\Users\WECPC015\BuPulse; git pull --ff-only; powershell -ExecutionPolicy Bypass -File .\scripts\self-host\windows\update.ps1
   ```
   The pull brings the new update.ps1, which finds no supervisor and takes the old way (Stop/Start-ScheduledTask, with
   the `finally` and the `.next-prev` safety). It ends with "Done: bupulse.com runs <commit>".
   If the branch is not on GitHub: on the Mac `git bundle create ~/Desktop/ops-nov13.bundle ops-nov13`, copy it to the
   PC's Downloads with Chrome Remote Desktop's file transfer, and use
   `git pull --ff-only $env:USERPROFILE\Downloads\ops-nov13.bundle ops-nov13` instead of `git pull --ff-only`.
2. Check: `Invoke-RestMethod http://127.0.0.1:3002/api/status` says `ok`; Admin -> Health loads; within 5 minutes the
   tick's log shows any catch-up (`Get-Content $env:USERPROFILE\bupulse-prod\cron.log -Tail 5`, look for `caughtUp`).
   A failed build needs nothing: update.ps1 puts the previous build back and starts it. Rollback of phase A if the new
   version misbehaves (administrator PowerShell; serves the previous build kept in `.next-prev`; the database changes of
   this branch: none):
   `cd C:\Users\WECPC015\BuPulse; Stop-ScheduledTask "BuPulse server"; Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue | % { Stop-Process -Id $_.OwningProcess -Force }; Rename-Item .next .next-bad; Rename-Item .next-prev .next; Start-ScheduledTask "BuPulse server"`

**Phase B: the supervisor switch (while watching the PC over remote desktop).** Down for 1 to 3 minutes.

1. **Administrator** PowerShell, ONE time:
   ```
   powershell -ExecutionPolicy Bypass -File C:\Users\WECPC015\BuPulse\scripts\self-host\windows\admin-once.ps1
   ```
   In this order: registers "BuPulse supervisor at boot" (S4U: runs with nobody signed in and survives sign-out; at
   startup and looked at every 5 minutes) and the per-user "BuPulse supervisor" (registered switched off for now);
   starts the boot task next to the old tasks (no second server and no jobs loop while the old server holds port 3002;
   its tunnel joins the old one); once its tunnel is connected, switches off (does not delete) "BuPulse jobs", then
   "BuPulse server" (stopping the old `next start` by the process ID on port 3002), then "BuPulse tunnel"; creates
   `jobs-on` if "BuPulse jobs" was on; switches the per-user task on; waits for /api/status; only then stops the
   cloudflared started by hand on 12 November (command line with tunnel-test.log) by its exact process ID. It ends with
   "Done: the supervisor runs ...". **If any of that fails it puts the old tasks back by itself**: the old tunnel first
   (so one connector always runs), then it stops the supervisor and switches its tasks off, then switches the old server
   and jobs on and starts them (each on its own try/catch), then checks https://bupulse.com for 3 minutes and prints a
   loud warning with the line to start a tunnel by hand if it does not answer.
2. Check (any PowerShell):
   ```
   Invoke-RestMethod http://127.0.0.1:3019/ | ConvertTo-Json -Depth 4; Get-Content $env:USERPROFILE\bupulse-prod\supervisor.log -Tail 15
   ```
   `server`, `tunnel` and `jobs` should say `"state": "running"` with a pid. Optional restart test (seconds offline):
   `New-Item -ItemType File -Force $env:USERPROFILE\bupulse-prod\restart-tunnel`; the log shows "restarting tunnel".
3. From then on every update is `powershell -ExecutionPolicy Bypass -File C:\Users\WECPC015\BuPulse\scripts\self-host\windows\update.ps1`
   in a **normal** PowerShell.

Rollback of phase B by hand (administrator PowerShell; one line):
`New-Item -ItemType File -Force $env:USERPROFILE\bupulse-prod\stop-supervisor; Start-Sleep 10; Disable-ScheduledTask "BuPulse supervisor"; Disable-ScheduledTask "BuPulse supervisor at boot"; Remove-Item $env:USERPROFILE\bupulse-prod\jobs-on -ErrorAction SilentlyContinue; Enable-ScheduledTask "BuPulse server"; Enable-ScheduledTask "BuPulse tunnel"; Enable-ScheduledTask "BuPulse jobs"; Start-ScheduledTask "BuPulse server"; Start-ScheduledTask "BuPulse tunnel"; Start-ScheduledTask "BuPulse jobs"`
(leave "BuPulse jobs" off if it was off before; delete `stop-supervisor` before ever running admin-once.ps1 again).
update.ps1 then takes the old way again by itself.

In the admin console (the owner, or the main session in the browser; keys are pasted there, never in PowerShell):
- **Composio**: Admin -> Services -> Composio, paste the new key, press **Test now**: the Health item "Composio refused
  BuPulse's API key" goes away at once (a newly pasted key is also used at once, without the test).
- **Telegram** (for the down alert on the phone): Admin -> Services -> Telegram, paste the bot token; send /start to the
  bot; Admin -> Settings -> Lead alerts -> **Connect**. Until then the alerts go by email only (Resend), and Health
  says Telegram is not set up.

Settings that are NOT changed by any script (do them by hand if wanted):
- BIOS/UEFI "Restore on AC power loss" (or "After power failure") = **Power On**: the PC starts by itself after a power
  cut, and "BuPulse supervisor at boot" brings the site back without anyone signing in.
- Windows Update active hours / restart times, the firewall, UAC and services stay as they are. Nothing listens outside
  127.0.0.1 (server 3002, supervisor 3019, cloudflared metrics 20249), so no firewall prompt appears.

### Supervisor (`supervisor.mjs`)

One Node process that starts and watches three pieces, without administrator rights:

| Piece | Command | Log |
|---|---|---|
| server | `node server.mjs start` (`next start` on 127.0.0.1:3002) | `server.log` |
| tunnel | `cloudflared tunnel --no-autoupdate --metrics 127.0.0.1:20249 --config ...\bupulse-prod.yml run bupulse-prod` | `tunnel.log` |
| jobs | `powershell -File cron-loop.ps1`, only while `%USERPROFILE%\bupulse-prod\jobs-on` exists | `jobs-loop.log` (the loop's own logs as before) |

- **Crashes:** a piece that exits is started again after 5 s, then 10, 20, 40 s ... up to 5 minutes while it keeps
  crashing within a minute; after a run of 10 minutes or more the count starts over. No restart storm.
- **Hangs:** the server is restarted when `http://127.0.0.1:3002/api/status` gives no answer at all for 2 minutes
  (after a 6-minute start grace: server.mjs reads Netlify's settings, then `next start`). Any HTTP answer counts as alive,
  so a database outage (503) does not make it restart in a loop. The tunnel is restarted when cloudflared's own
  `/ready` has said "not connected" for 5 minutes.
- **Exact process IDs only:** every stop is `taskkill /PID <the pid it started> /T /F` (that process and its children,
  so `next start` never keeps port 3002), never by name. If the supervisor itself was killed hard, the next one stops a
  leftover piece only when Windows confirms that PID's start time is the one it recorded (a reused PID is left alone).
  If port 3002 is held by a process it did not start (the old task), it never starts a second server, never starts the
  jobs loop (the old tasks may run their own), and says so once. The server's `next start` listener (a grandchild) is
  recorded with its start time once the server answers; if it is left holding the port after its parents died, it is
  stopped by that PID only when the start time matches.
- **Every start, exit and restart** is one line in `%USERPROFILE%\bupulse-prod\supervisor.log` (moved to `.log.1` past
  5 MB; the piece logs past 20 MB). State every 15 s in `supervisor-state.json`, and live at `http://127.0.0.1:3019/`.
- **One at a time:** it holds 127.0.0.1:3019; the boot task and the sign-in task can both start it, the second one exits.
- **Started by:** "BuPulse supervisor at boot" (S4U, at startup and every 5 minutes, runs with nobody signed in and
  survives sign-out; administrator to register: `admin-once.ps1`) and "BuPulse supervisor" (this user, at sign-in and
  every 5 minutes, hidden through `supervisor-hidden.vbs` and `wscript`, no administrator: `setup-supervisor.ps1`;
  registered switched off while the old tasks are on). If the supervisor stops, a task starts it again within 1 to 5
  minutes.
- **Control files** in `%USERPROFILE%\bupulse-prod` (a normal PowerShell, `New-Item -ItemType File -Force <path>`):
  `pause-server` (stop the server until the file is deleted; update.ps1; ignored and logged once it is older than 45
  minutes, so a failed update never keeps the site off), `restart-server`, `restart-tunnel`,
  `restart-jobs` (once; the file is removed), `jobs-on` (run the jobs loop; ONE computer only), `restart-supervisor`
  (a fresh supervisor; update.ps1 does it when supervisor.mjs changed), `stop-supervisor` (stop everything; while it
  exists the supervisor does not start).

### Down alert

Every minute the supervisor checks `https://bupulse.com/api/status` from outside (through the internet, Cloudflare and
the tunnel) and posts the result to the local server (`POST /api/monitor/watch`, Bearer: this PC's `cron-secret.txt`).
The server (`lib/monitor/watch.ts`, rules in `lib/monitor/watch-rules.ts`, state in the AdminSetting `monitor.watch`):
- sends **one** "bupulse.com is down" message once the outside check has failed for 2 minutes (the third failure in a
  row), with the likely cause (website not answering, tunnel not connected, database down, or outside the PC);
- sends **one** "bupulse.com is back up (down about N minutes)" when it answers again;
- when the website itself was down (crashed or hung, being restarted), the supervisor reports since when once the
  server can take reports again: one "was down N minutes, back now" message (a message cannot be sent while the server
  is down);
- never counts an update (`pause-server`) or the supervisor's own first start as an outage;
- tries an undelivered message again next minute; a channel that is not set up is skipped, not retried.
Channels: Telegram (the chat connected in Admin -> Settings -> Lead alerts, the bot token from Admin -> Services or the
environment) and email to admin@bupulse.com through Resend, the same as the "back up" alert.
The uptime record (`lib/monitor/uptime.ts`, GitHub's 5-minute check and the PC's own 5-minute check) keeps recording
outages for the Server page, but sends no second "back up" message for an outage the watch saw from its start. When the
whole PC was off, the watch saw nothing, so the uptime record's "back up" message goes out as before.

**When the whole PC is off** nothing on it can send anything. The GitHub workflow `.github/workflows/uptime.yml` can:
its "down" alert stays **on**; set the repository variable `UPTIME_DOWN_ALERT=off` (GitHub -> Settings -> Secrets and
variables -> Actions -> Variables) to switch it off. It needs the repository secrets TELEGRAM_BOT_TOKEN and
TELEGRAM_CHAT_ID and/or RESEND_API_KEY. Free (public repository), but GitHub's 5-minute schedule often runs late, and in
a tunnel-only outage both the PC and GitHub may send a "down" message (accepted).

### Missed jobs (catch-up)

The tick only ran the jobs due in the minute it ran, so after a power cut (or a restart, or a tick long enough to skip
a job's minute) a daily job stayed "overdue" on Admin -> Health until the next day. Now the tick (`lib/cron/catch-up.ts`,
`lib/cron/catch-up-run.ts`) runs each missed job **once** when the server is back: a scheduled time counts as missed
when it is at least 20 minutes old and no run started since; a job due again within 15 minutes just waits; jobs that run
every 30 minutes or more often (the publisher, the Video Studio sweep, Autopilot pictures) are never caught up; one job
per tick, inside its own 2.5-minute budget (no new cursor call after it), so the next minute's publisher is not held;
each missed time once per server process. It looks every 5 minutes (and right after the server starts). The
tick's answer lists `caughtUp`, one "catch-up" row is written to CronRun, and Health shows the job as **Caught up**
(hover: which time it made up for) instead of overdue.
No duplicate posts: the publisher is not part of it; it claims each post atomically, never sends again a post that was
mid-publish when the power went (it becomes "check the network", `sweepStalePosts`), and leaves posts from a past local
day to the carry-over (the daily-posts job, which is caught up). Every caught-up route claims its own work ("safe to run
twice": one digest per business and day, one notice per renewal, one daily-posts run per company and day).

### Partner faults on Health (Composio, Upload-Post)

A partner refusing BuPulse itself is one Admin -> Health item, not an error per call (`lib/admin/service-faults.ts`):
- **Composio "invalid API key"** (a 401/403 that names the API key, or a 401/403 in other words confirmed by one cheap
  call that involves no client, the toolkits list; one client's broken connected account never pauses everyone): recorded once (one warning in Admin -> Errors), a Health
  problem "Composio refused BuPulse's API key", and Composio is not called again with that key (one try every 15
  minutes). A newly pasted key is used at once; a good answer or a passing Test now clears it. Only a short hash of the
  refused key is stored, never the key.
- **Upload-Post profile limit** (a new company's profile cannot be made): the company sees "paused on our side", Health
  shows "Upload-Post's profile limit is reached" (for a week after the last try), and while it lasts a new profile is
  asked for at most every 30 minutes (pressing Connect again only costs a cheap look-up). A company whose profile exists
  still connects. A profile made later clears it. A 429 while making a profile is rate limiting ("busy, try again in a
  minute"), not the profile limit.
- **Upload-Post refused key / posting limit**: the same way (posts wait and are tried again; nothing is lost).
The errors thrown for these carry `serviceFault`, so `logError` leaves them out of Admin -> Errors.

### Telegram warnings

"quote alert not sent by telegram: TELEGRAM_BOT_TOKEN is not set" was written to Admin -> Errors on every quote request
and website chat (`lib/lead-alerts/channels.ts`). Now the token is read like every other key (`resolveTelegramToken`:
the value saved in Admin -> Services wins, else the environment's, after loading the saved keys), and a "not set up"
warning is written once a day per reason; Admin -> Health keeps listing it until it is set up.

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
3. **Update and restart:** `update.ps1` (it rebuilds, restarts the server, and has the supervisor restart the jobs
   loop, which starts the worker thread). After updating by hand:
   `New-Item -ItemType File -Force $env:USERPROFILE\bupulse-prod\restart-jobs`. The supervisor stops the jobs loop with
   its children (the worker included) by the loop's process ID. (With the old "BuPulse jobs" task, stopping it could
   leave a worker running for up to an hour; that is safe thanks to the lease.)
4. **Check it:** after a Create post with a video, `Get-Content "$env:USERPROFILE\bupulse-prod\videos.log" -Tail 20`
   should show "Claimed: videos 1" and "Run finished: claimed 1, made 1, failed 0" within a minute or two.
   Self-test on the PC, no database: `node scripts\video-robot\self-test.mjs --worker` with `$env:ROBOT_CHROME_CHANNEL="msedge,chrome"`.

Cost: none (the PC's own CPU; a 15-second 1080x1920 reel takes about 20 to 40 seconds to render). The Mac's
`cron-loop.sh` has no render worker (the Mac copy is off).
