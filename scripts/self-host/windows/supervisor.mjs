// The BuPulse supervisor on the home Windows PC (docs/SELF_HOST.md, "Supervisor"). One long-running Node process that
// starts and watches the three pieces of bupulse.com and brings each back by itself:
//
//   server  node scripts/self-host/windows/server.mjs start   (next start on 127.0.0.1:3002, behind the tunnel)
//   tunnel  cloudflared tunnel run bupulse-prod                (bupulse.com -> 127.0.0.1:3002)
//   jobs    powershell -File scripts/self-host/windows/cron-loop.ps1   (only while %USERPROFILE%\bupulse-prod\jobs-on exists)
//
// What it does, all without admin rights:
// - A piece that exits is started again after 5 s, then 10, 20, 40 s ... up to 5 minutes while it keeps crashing
//   within a minute (no restart storm); a piece that ran 10 minutes starts again at once next time.
// - The server is also restarted when it stops answering http://127.0.0.1:3002/api/status at all (any HTTP answer counts
//   as alive: a 503 because the database is down is not fixed by a restart) for 5 minutes, after a 6-minute start grace.
// - The tunnel is restarted when cloudflared's own /ready (metrics on 127.0.0.1:20249) has said "not ready" for 5 minutes.
// - Every stop is by the exact process ID it started (taskkill /PID <pid> /T /F: that process and its children), never by
//   process name. A piece left running by a previous supervisor (killed hard) is stopped only when Windows confirms its
//   start time is the one recorded for it. Each start, exit and restart is one line in supervisor.log.
// - Every minute it checks https://bupulse.com/api/status from outside (internet, Cloudflare, the tunnel) and reports it
//   to the local server (POST /api/monitor/watch, Bearer: this PC's cron-secret.txt), which sends the owner ONE Telegram
//   and email message when the site has been down for 2 minutes and one when it is back (lib/monitor/watch.ts).
// - Every 10 minutes it checks for the crypto-miner of 17 November 2026 (a fake "dlIhost" in %APPDATA%\DLL): names that
//   imitate Windows programs, programs running from %APPDATA%\DLL, that folder itself, a Windows name outside the
//   Windows folder, over 2 GB of memory (findSuspicious). A finding is one SECURITY line in supervisor.log and one
//   Telegram and email message through the local server (POST /api/monitor/pc-alert, same Bearer), again at most every
//   24 hours (security-alerts.json). A server from before that route answers 404: then it is logged only.
//
// Control files in %USERPROFILE%\bupulse-prod (update.ps1 uses them; no admin needed):
//   pause-server       stop the server and keep it stopped (while update.ps1 builds); delete it to start again. A
//                      pause-server older than 45 minutes is ignored (and logged): a failed update never keeps the site off
//   restart-server     restart-tunnel     restart-jobs     restart that piece once (the file is removed)
//   jobs-on            run the jobs loop (the scheduled jobs must run on ONE computer only). Never while port 3002
//                      belongs to a server this supervisor did not start (the old tasks may still run their own loop)
//   restart-supervisor stop the pieces and start a fresh supervisor (update.ps1, when supervisor.mjs changed)
//   stop-supervisor    stop everything and exit; while it exists the supervisor does not start
//
// One supervisor at a time: it holds 127.0.0.1:3019, which also answers GET / with its state as JSON (no secrets).
// State is also written to supervisor-state.json every 15 s (the heartbeat in cron-loop.ps1 reads it).
//
//   node scripts/self-host/windows/supervisor.mjs          (Task Scheduler runs it: setup-supervisor.ps1, admin-once.ps1)

import { execFile, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer, connect } from "node:net";
import { homedir, uptime } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const LOCK_PORT = 3019;
export const SERVER_PORT = 3002;
export const TUNNEL_METRICS = "127.0.0.1:20249";
export const SITE_URL = "https://bupulse.com";

export const TIMING = {
  /** How often control files and children are looked at. */
  controlMs: 2_000,
  /** How often the server and the tunnel are health-checked. */
  healthMs: 30_000,
  /** How often the public site is checked and reported (the down alert). */
  probeMs: 60_000,
  /** server.mjs reads the production settings from Netlify, then next start: give it this long before health checks. */
  startGraceMs: 6 * 60_000,
  /** No answer at all from the server for this long: it hangs, restart it. 5 minutes, not 2: on the PC's slow disk a
   * fresh server can take minutes to answer, and each restart only started the wait over (17 November 2026). */
  hangMs: 5 * 60_000,
  /** A server that has not answered even once since it started gets this long in all before it is called hung: on the
   * PC's HDD (100% busy, ~1.4 MB/s) `next start` needed more than 11 minutes, so the 6 + 5 minute rule restarted it
   * forever and the site never came back (23 November 2026). Once it has answered, `hangMs` applies. */
  firstAnswerMs: 25 * 60_000,
  /** How long one health check waits for /api/status. */
  probeTimeoutMs: 20_000,
  /** cloudflared not ready for this long: restart it. */
  tunnelNotReadyMs: 5 * 60_000,
  /** A piece that ran at least this long starts again without waiting next time. */
  healthyRunMs: 10 * 60_000,
  /** A piece that exits sooner than this counts as a quick crash (the wait doubles). */
  quickCrashMs: 60_000,
  /** How often supervisor-state.json is written. */
  stateMs: 15_000,
  /** A pause-server file older than this is left over from a failed update: ignored. */
  maxPauseMs: 45 * 60_000,
  /** How often the running programs are checked for the crypto-miner (the fake "dlIhost", 17 November 2026). */
  securityMs: 10 * 60_000,
  /** The first miner check, this long after the supervisor starts. */
  securityFirstMs: 60_000,
  /** The same finding is sent to the owner again at most this often. */
  securityRepeatMs: 24 * 60 * 60_000,
};

const MAX_LOG_BYTES = 20 * 1024 * 1024;

/** The wait before starting a piece again after `quickCrashes` crashes in a row: 5 s, 10, 20, 40 ... up to 5 minutes. */
export function backoffMs(quickCrashes) {
  return Math.min(5_000 * 2 ** Math.max(0, quickCrashes), 5 * 60_000);
}

/** After a piece exited: how many quick crashes in a row now, and when it may start again. */
export function afterExit({ startedAt, exitedAt, quickCrashes }, timing = TIMING) {
  const lived = exitedAt - startedAt;
  const quick = lived < timing.quickCrashMs ? quickCrashes + 1 : lived >= timing.healthyRunMs ? 0 : quickCrashes;
  const wait = lived >= timing.healthyRunMs ? 5_000 : backoffMs(quick);
  return { quickCrashes: quick, nextStartAt: exitedAt + wait, waitMs: wait };
}

/**
 * Does the server hang? Only after its start grace, and only when nothing answered for `hangMs` (counted from the end
 * of the grace or the last answer, whichever is later).
 */
export function serverHangs({ startedAt, lastAnswerAt, now }, timing = TIMING) {
  if (lastAnswerAt == null && timing.firstAnswerMs) return now - startedAt >= Math.max(timing.firstAnswerMs, timing.startGraceMs + timing.hangMs);
  const graceEnd = startedAt + timing.startGraceMs;
  if (now < graceEnd) return false;
  return now - Math.max(graceEnd, lastAnswerAt ?? 0) >= timing.hangMs;
}

/** Is the tunnel stuck? Not ready for `tunnelNotReadyMs` since it started or was last ready. */
export function tunnelStuck({ startedAt, lastReadyAt, now }, timing = TIMING) {
  return now - Math.max(startedAt, lastReadyAt ?? 0) >= timing.tunnelNotReadyMs;
}

/** Is a recorded start time the same process (Windows reuses process IDs)? Within 5 seconds. */
export function sameStart(recordedIso, actualIso) {
  const a = Date.parse(recordedIso ?? "");
  const b = Date.parse(actualIso ?? "");
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 5_000;
}

/** The computer's boot time, to the minute (a state file from before a restart is about other processes). */
export function bootTime(now = Date.now(), up = uptime()) {
  return new Date(Math.floor((now - up * 1000) / 60_000) * 60_000).toISOString();
}

// ---- the real processes (Windows; the tests pass their own) ---------------------------------------------------

/** Stops the process `pid` and its children, by that ID only. */
export function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  // Elsewhere (the tests): each child leads its own process group, whose ID is its PID.
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

/** Is process `pid` alive? */
export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/** When Windows says process `pid` started (ISO), or null. Used only to confirm a PID before stopping a leftover. */
export function processStartedAt(pid) {
  if (process.platform !== "win32" || !pid) return null;
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${Number(pid)} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`], { windowsHide: true, encoding: "utf8" });
  const text = (r.stdout ?? "").trim();
  return r.status === 0 && text ? text : null;
}

/**
 * The process listening on `port` and when it started ({ pid, startedAt }), or null. Recorded once the server answers,
 * because the listener (`next start`) is a grandchild of the process the supervisor started (node -> cmd -> npx -> next):
 * if its parents die it can be left holding the port, and it is then stopped by this PID only when its start time matches.
 */
export function listenerOf(port) {
  if (process.platform !== "win32") return null;
  const script = `$c = Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction Stop | Select-Object -First 1; $p = Get-Process -Id $c.OwningProcess -ErrorAction Stop; "$($c.OwningProcess)|$($p.StartTime.ToUniversalTime().ToString('o'))"`;
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, encoding: "utf8" });
  const [pid, startedAt] = (r.stdout ?? "").trim().split("|");
  return r.status === 0 && Number(pid) > 0 && startedAt ? { pid: Number(pid), startedAt } : null;
}

/** Is something listening on 127.0.0.1:`port`? */
export function portInUse(port, host = "127.0.0.1") {
  return new Promise((done) => {
    const socket = connect({ port, host });
    const finish = (v) => {
      socket.destroy();
      done(v);
    };
    socket.setTimeout(2_000, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

/** GET `url`: the HTTP status, or null when nothing answered in time. */
export async function httpStatus(url, timeoutMs = 10_000, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(url, { headers: { "cache-control": "no-cache", "user-agent": "BuPulse supervisor" }, signal: AbortSignal.timeout(timeoutMs) });
    await res.text().catch(() => "");
    return res.status;
  } catch {
    return null;
  }
}

/** Moves a log past `max` bytes to <name>.1 (one old copy kept), so logs never fill the disk. */
export function rotateIfBig(path, max = MAX_LOG_BYTES) {
  try {
    if (existsSync(path) && statSync(path).size > max) renameSync(path, `${path}.1`);
  } catch {
    // A log that cannot be moved is still appended to.
  }
}

// ---- the miner check (17 November 2026) -------------------------------------------------------------------------
// A crypto-miner ran as "dlIhost" (capital i, imitating Windows' "dllhost") from %APPDATA%\DLL\dlIhost.exe with the
// WinRing0x64.sys driver beside it, held 2.35 GB and froze the PC. Defender removed it on 7 and 12 November and it came
// back. Every 10 minutes the supervisor lists the running programs (no admin rights: the paths of the system's own
// processes stay hidden, this user's are visible) and looks for it; process-name-check.ps1 is the same name rule.

/** Real Windows programs a miner likes to imitate (lower case, without .exe). */
export const WINDOWS_NAMES = ["svchost", "dllhost", "lsass", "csrss", "winlogon", "services", "smss", "explorer", "taskhostw", "conhost", "rundll32", "spoolsv", "wininit", "searchhost", "runtimebroker", "sihost", "ctfmon", "dwm", "wmiprvse"];
/** Programs allowed to hold over 2 GB of private memory (lower case, without .exe). */
const BIG_OK = new Set(["node", "msmpeng", "memory compression", "vmmem", "vmmemwsl", "chrome", "msedge", "firefox", "code"]);
const BIG_BYTES = 2 * 1024 ** 3;

/** Lower case with the letters a look-alike swaps: 1, I, i and | become l, 0 becomes o. */
const canon = (s) => s.toLowerCase().replace(/[1i|]/g, "l").replace(/0/g, "o");
const winPath = (p) => String(p).replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

/** The real Windows name `name` imitates ("dlIhost" -> "dllhost"), or null (also null for the real one, any case). */
export function lookAlikeOf(name) {
  const n = String(name ?? "").replace(/\.exe$/i, "");
  if (!n || WINDOWS_NAMES.includes(n.toLowerCase())) return null;
  return WINDOWS_NAMES.find((real) => canon(n) === canon(real)) ?? null;
}

/**
 * The miner check, pure (tests/self-host/supervisor.test.ts). `processes`: [{ pid, name, path, privateBytes }] (path
 * null when Windows hides it); `appData`: %APPDATA%; `dllFolderExists`: does %APPDATA%\DLL exist. One finding per
 * suspicious process (all its reasons) plus one for the folder; `key` (name + path) is what alerts are counted by.
 * Reasons: "lookalike" (a name imitating a Windows program), "dll-path" (runs from %APPDATA%\DLL), "dll-folder" (the
 * folder is back), "system-name-path" (a Windows program's name running from outside the Windows folder), "memory"
 * (over 2 GB private memory and not a program known to need it).
 * @param {{ processes?: { pid?: number | null, name?: string, path?: string | null, privateBytes?: number }[], appData?: string, dllFolderExists?: boolean, windowsDir?: string }} o
 */
export function findSuspicious({ processes = [], appData = "", dllFolderExists = false, windowsDir = "C:\\Windows" }) {
  const dllDir = appData ? `${winPath(appData)}\\dll\\` : null;
  const winDir = `${winPath(windowsDir)}\\`;
  const findings = [];
  for (const p of processes) {
    const name = String(p?.name ?? "").replace(/\.exe$/i, "");
    if (!name) continue;
    const path = p.path ? String(p.path) : null;
    const reasons = [];
    const looksLike = lookAlikeOf(name);
    if (looksLike) reasons.push("lookalike");
    if (path && dllDir && winPath(path).startsWith(dllDir)) reasons.push("dll-path");
    if (path && WINDOWS_NAMES.includes(name.toLowerCase()) && !winPath(path).startsWith(winDir)) reasons.push("system-name-path");
    const bytes = Number(p.privateBytes);
    if (Number.isFinite(bytes) && bytes > BIG_BYTES && !BIG_OK.has(name.toLowerCase())) reasons.push("memory");
    if (!reasons.length) continue;
    findings.push({ key: `${name.toLowerCase()}|${path ? winPath(path) : ""}`, name, path, pid: Number(p.pid) || null, memMb: Number.isFinite(bytes) ? Math.round(bytes / 1024 ** 2) : null, looksLike, reasons });
  }
  if (dllFolderExists && appData) {
    const path = `${appData.replace(/[\\/]+$/, "")}\\DLL`;
    findings.push({ key: `folder|${winPath(path)}`, name: "DLL folder", path, pid: null, memMb: null, looksLike: null, reasons: ["dll-folder"] });
  }
  return findings;
}

/** The findings to send now: never sent, or last sent at least `repeatMs` ago (`sent`: key -> time sent). */
export function dueFindings(findings, sent, now, repeatMs = TIMING.securityRepeatMs) {
  return findings.filter((f) => {
    const at = sent?.[f.key];
    return typeof at !== "number" || now - at >= repeatMs;
  });
}

/** One line for supervisor.log (no secrets: names, paths, memory). */
export function findingLine(f) {
  const words = { lookalike: `looks like Windows "${f.looksLike}"`, "dll-path": "runs from %APPDATA%\\DLL", "dll-folder": "the folder is back", "system-name-path": "a Windows name outside the Windows folder", memory: `${f.memMb} MB private memory` };
  return `SECURITY: suspicious ${f.reasons.includes("dll-folder") ? "folder" : `program "${f.name}"`} (${f.reasons.map((r) => words[r] ?? r).join("; ")})${f.pid ? ` pid ${f.pid}` : ""} path ${f.path ?? "(hidden)"}`;
}

/** PowerShell's process list (ConvertTo-Json: one process comes as an object, not a list) as [{ pid, name, path, privateBytes }]. */
export function parseProcessList(text) {
  let raw;
  try {
    raw = JSON.parse(String(text ?? "").replace(/^﻿/, "").trim() || "[]");
  } catch {
    return null;
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return list.filter((p) => p && typeof p.name === "string").map((p) => ({ pid: Number(p.pid) || null, name: p.name, path: typeof p.path === "string" && p.path ? p.path : null, privateBytes: Number(p.priv) || 0 }));
}

/** The running programs (Windows; no admin rights), or null when they could not be listed. Never blocks the supervisor. */
export function listProcesses(timeoutMs = 60_000) {
  if (process.platform !== "win32") return Promise.resolve(null);
  const script = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; @(Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; name = $_.Name; path = $_.ExecutablePath; priv = $_.PrivatePageCount } }) | ConvertTo-Json -Compress";
  return new Promise((done) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" }, (error, stdout) => done(error ? null : parseProcessList(stdout)));
  });
}

// ---- the supervisor ---------------------------------------------------------------------------------------------

/**
 * The pieces to run. `config` (supervisor-config.json, written by setup-supervisor.ps1) may name full paths for node
 * and cloudflared; otherwise this Node and the cloudflared on PATH are used.
 */
export function defaultSpecs({ repo, logs, config = {} }) {
  const node = config.node || process.execPath;
  const cloudflared = config.cloudflared || "cloudflared";
  const tunnelConfig = config.tunnelConfig || join(homedir(), ".cloudflared", "bupulse-prod.yml");
  return {
    server: { cmd: node, args: [join(repo, "scripts", "self-host", "windows", "server.mjs"), "start"], cwd: repo, log: join(logs, "server.log") },
    tunnel: { cmd: cloudflared, args: ["tunnel", "--no-autoupdate", "--metrics", TUNNEL_METRICS, "--config", tunnelConfig, "run", "bupulse-prod"], cwd: repo, log: join(logs, "tunnel.log") },
    jobs: { cmd: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(repo, "scripts", "self-host", "windows", "cron-loop.ps1")], cwd: repo, log: join(logs, "jobs-loop.log") },
  };
}

const NAMES = ["server", "tunnel", "jobs"];

export class Supervisor {
  /**
   * @param {object} o
   * @param {string} o.logs           %USERPROFILE%\bupulse-prod
   * @param {Record<string, {cmd: string, args: string[], cwd: string, log: string}>} o.specs
   * @param {object} [o.timing]
   * @param {() => number} [o.now]
   * @param {typeof fetch} [o.fetchImpl]
   * @param {(pid: number) => void} [o.kill]
   * @param {(pid: number) => string | null} [o.startedAtOf]
   * @param {(port: number) => Promise<boolean>} [o.portBusy]
   * @param {(port: number) => ({ pid: number, startedAt: string } | null)} [o.listenerOf]
   * @param {string} [o.localUrl]     http://127.0.0.1:3002
   * @param {string} [o.siteUrl]      https://bupulse.com
   * @param {string} [o.tunnelReadyUrl]
   * @param {boolean} [o.probe]       report the public check to the local server (off in most tests)
   * @param {() => void} [o.respawn]  starts a fresh supervisor (restart-supervisor)
   * @param {boolean} [o.security]    run the miner check (on Windows by default)
   * @param {() => Promise<object[] | null>} [o.listProcesses]
   * @param {string} [o.appData]      %APPDATA%
   * @param {string} [o.windowsDir]   %SystemRoot%
   */
  constructor(o) {
    this.logs = o.logs;
    this.specs = o.specs;
    this.timing = { ...TIMING, ...(o.timing ?? {}) };
    this.now = o.now ?? Date.now;
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.kill = o.kill ?? killTree;
    this.startedAtOf = o.startedAtOf ?? processStartedAt;
    this.portBusy = o.portBusy ?? ((port) => portInUse(port));
    this.listenerOf = o.listenerOf ?? listenerOf;
    this.stalePauseSeen = null;
    this.localUrl = o.localUrl ?? `http://127.0.0.1:${SERVER_PORT}`;
    this.siteUrl = o.siteUrl ?? SITE_URL;
    this.tunnelReadyUrl = o.tunnelReadyUrl ?? `http://${TUNNEL_METRICS}/ready`;
    this.probeOn = o.probe ?? true;
    this.respawn = o.respawn ?? null;
    this.startedAt = new Date(this.now()).toISOString();
    this.children = Object.fromEntries(
      NAMES.filter((n) => this.specs[n]).map((n) => [n, { pid: null, proc: null, state: "stopped", startedAt: 0, startedIso: null, quickCrashes: 0, nextStartAt: 0, restarts: 0, lastExit: null, mode: null, lastAnswerAt: null, foreign: false, listener: null, waitLogged: false }]),
    );
    // serverSeenUp: the server answered at least once since this supervisor started, so a later silence is an outage
    // (the supervisor's own first start after a reboot is not: the uptime record covers a PC that was off).
    this.watch = { localDownSince: null, maintenanceUntil: 0, last: null, serverSeenUp: false };
    this.securityOn = o.security ?? process.platform === "win32";
    this.listProcesses = o.listProcesses ?? listProcesses;
    this.appData = o.appData ?? process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    this.windowsDir = o.windowsDir ?? process.env.SystemRoot ?? "C:\\Windows";
    // sent: finding key -> when the owner was told (security-alerts.json, so a restart does not tell again);
    // logged: the same for supervisor.log (in memory).
    this.security = { sent: this.readSecuritySent(), logged: {}, lastScanAt: null, findings: [], listFailed: false, unsupportedLogged: false, lastFailure: null };
    this.timers = [];
    this.stopped = false;
  }

  readSecuritySent() {
    try {
      const v = JSON.parse(readFileSync(this.file("security-alerts.json"), "utf8")).sent;
      return Object.fromEntries(Object.entries(v ?? {}).filter(([, at]) => typeof at === "number"));
    } catch {
      return {};
    }
  }

  saveSecuritySent() {
    const keep = Object.fromEntries(Object.entries(this.security.sent).filter(([, at]) => this.now() - at < 7 * this.timing.securityRepeatMs));
    this.security.sent = keep;
    try {
      writeFileSync(this.file("security-alerts.json"), JSON.stringify({ sent: keep }, null, 1));
    } catch {
      // Kept in memory; written next time.
    }
  }

  file(name) {
    return join(this.logs, name);
  }

  log(line) {
    const text = `${new Date(this.now()).toISOString()} ${line}\n`;
    try {
      rotateIfBig(this.file("supervisor.log"), 5 * 1024 * 1024);
      appendFileSync(this.file("supervisor.log"), text);
    } catch {
      // Logging never stops the supervisor.
    }
  }

  /** The pieces that should run now. */
  /** Is the server paused by update.ps1? A pause-server older than maxPauseMs is ignored (a failed update). */
  paused() {
    const file = this.file("pause-server");
    let mtime;
    try {
      mtime = statSync(file).mtimeMs;
    } catch {
      this.stalePauseSeen = null;
      return false;
    }
    if (Date.now() - mtime <= this.timing.maxPauseMs) return true;
    if (this.stalePauseSeen !== mtime) {
      this.stalePauseSeen = mtime;
      this.log(`pause-server is older than ${Math.round(this.timing.maxPauseMs / 60_000)} minutes (left by a failed update?): ignored, the server runs. Delete the file.`);
    }
    return false;
  }

  wanted() {
    return {
      server: !this.paused(),
      tunnel: true,
      jobs: existsSync(this.file("jobs-on")),
    };
  }

  start(name) {
    const c = this.children[name];
    const spec = this.specs[name];
    rotateIfBig(spec.log);
    let fd;
    try {
      fd = openSync(spec.log, "a");
    } catch {
      fd = "ignore";
    }
    let proc;
    try {
      proc = spawn(spec.cmd, spec.args, { cwd: spec.cwd, stdio: ["ignore", fd, fd], windowsHide: true, detached: process.platform !== "win32", env: process.env });
    } catch (error) {
      if (typeof fd === "number") closeSync(fd);
      this.onExit(name, null, `could not start: ${error?.message ?? error}`);
      return;
    }
    if (typeof fd === "number") closeSync(fd);
    c.proc = proc;
    c.pid = proc.pid ?? null;
    c.state = "running";
    c.startedAt = this.now();
    c.startedIso = new Date(c.startedAt).toISOString();
    c.lastAnswerAt = null;
    c.mode = null;
    c.listener = null;
    c.waitLogged = false;
    proc.once("error", (error) => {
      if (c.proc === proc) this.onExit(name, null, `failed: ${error?.message ?? error}`);
    });
    proc.once("exit", (code, signal) => {
      if (c.proc === proc) this.onExit(name, code, signal ? `signal ${signal}` : null);
    });
    this.log(`start ${name}: pid ${c.pid}${c.restarts ? ` (restart ${c.restarts})` : ""}`);
    this.writeState();
  }

  onExit(name, code, note) {
    const c = this.children[name];
    const now = this.now();
    const mode = c.mode;
    const pid = c.pid;
    const lived = c.startedAt ? Math.round((now - c.startedAt) / 1000) : 0;
    c.proc = null;
    c.pid = null;
    c.mode = null;
    c.lastExit = { at: new Date(now).toISOString(), code, note, asked: mode };
    if (mode === "stop") {
      c.state = this.wanted()[name] ? "stopped" : name === "server" ? "paused" : "off";
      this.log(`stopped ${name}: pid ${pid} ended`);
    } else if (mode === "restart") {
      // Restarted on purpose (it hung, or a restart file): start again at once.
      c.state = "restarting";
      c.nextStartAt = now;
      c.restarts += 1;
      this.log(`stopped ${name}: pid ${pid} ended after ${lived} s; starting again now`);
    } else {
      const next = afterExit({ startedAt: c.startedAt || now, exitedAt: now, quickCrashes: c.quickCrashes }, this.timing);
      c.quickCrashes = next.quickCrashes;
      c.nextStartAt = next.nextStartAt;
      c.state = "restarting";
      c.restarts += 1;
      this.log(`exit ${name}: pid ${pid} ended by itself (code ${code ?? "none"}${note ? `, ${note}` : ""}) after ${lived} s; starting again in ${Math.round(next.waitMs / 1000)} s`);
    }
    // The site is down while the server is (unless it was stopped on purpose for an update).
    if (name === "server" && mode !== "stop" && this.watch.serverSeenUp) this.watch.localDownSince ??= now;
    this.writeState();
  }

  /** Stops one piece by its own PID. `restart`: start it again as soon as it has ended, without a crash wait. */
  stop(name, reason, { restart = false } = {}) {
    const c = this.children[name];
    if (!c?.pid || c.mode) return;
    c.mode = restart ? "restart" : "stop";
    this.log(`${restart ? "restarting" : "stopping"} ${name}: pid ${c.pid} (${reason})`);
    this.kill(c.pid);
  }

  /**
   * A piece the previous supervisor left running (it was killed hard): stopped only when its PID is alive and Windows
   * confirms its start time is the one recorded, so a reused PID is never touched.
   */
  stopLeftovers() {
    let prev;
    try {
      prev = JSON.parse(readFileSync(this.file("supervisor-state.json"), "utf8"));
    } catch {
      return;
    }
    if (!prev || prev.bootAt !== bootTime(this.now())) return;
    const leftovers = NAMES.map((name) => [name, prev.children?.[name]]);
    // The server's `next start` listener, recorded separately (it can outlive its parents).
    if (prev.children?.server?.listener) leftovers.push(["server listener", prev.children.server.listener]);
    for (const [name, old] of leftovers) this.stopIfSame(name, old, "started by the previous supervisor");
  }

  /** Stops `old.pid` only when it is alive and Windows confirms its start time is `old.startedAt`. */
  stopIfSame(name, old, why) {
    if (!old?.pid || !old.startedAt || !isAlive(old.pid)) return false;
    const actual = this.startedAtOf(old.pid);
    if (!sameStart(old.startedAt, actual)) {
      this.log(`leftover ${name}: pid ${old.pid} is alive but is not the process recorded; left alone`);
      return false;
    }
    this.log(`leftover ${name}: stopping pid ${old.pid}, ${why} at ${old.startedAt}`);
    this.kill(old.pid);
    return true;
  }

  async controlRound() {
    if (this.stopped) return;
    if (existsSync(this.file("stop-supervisor"))) {
      this.log("stop-supervisor found: stopping everything");
      await this.shutdown();
      return;
    }
    if (existsSync(this.file("restart-supervisor"))) {
      // A new supervisor.mjs (update.ps1): stop the pieces, start a fresh copy that waits for the lock, and exit.
      try {
        rmSync(this.file("restart-supervisor"), { force: true });
      } catch {
        // The new copy removes it.
      }
      this.log("restart-supervisor found: starting a fresh supervisor");
      await this.shutdown();
      this.respawn?.();
      return;
    }
    const want = this.wanted();
    const now = this.now();
    for (const name of Object.keys(this.children)) {
      const c = this.children[name];
      const request = this.file(`restart-${name}`);
      if (existsSync(request)) {
        try {
          rmSync(request, { force: true });
        } catch {
          // Removed next round.
        }
        if (c.pid) this.stop(name, "asked by restart file", { restart: true });
        else c.nextStartAt = now;
      }
      if (!want[name]) {
        if (c.pid) this.stop(name, name === "server" ? "pause-server" : "jobs-on removed");
        c.state = name === "server" ? "paused" : "off";
        if (name === "server") this.watch.maintenanceUntil = Number.POSITIVE_INFINITY;
        continue;
      }
      if (c.pid) continue;
      if (name === "server" && this.watch.maintenanceUntil === Number.POSITIVE_INFINITY) {
        // Back from a pause (an update): the server's start is planned, not an outage.
        this.watch.maintenanceUntil = now + this.timing.startGraceMs;
        this.watch.localDownSince = null;
      }
      if (now < c.nextStartAt) {
        c.state = "restarting";
        continue;
      }
      if (name === "jobs" && this.children.server?.foreign) {
        // The old tasks may still run their own server and jobs loop: never run the scheduled jobs twice.
        if (!c.waitLogged) this.log("jobs: not starting while port 3002 belongs to a server this supervisor did not start");
        c.waitLogged = true;
        c.state = "waiting";
        continue;
      }
      if (name === "server" && (await this.portBusy(SERVER_PORT))) {
        // Our own `next start` left behind when its parents died (recorded PID and start time): stop it, start ours.
        if (c.listener && this.stopIfSame("server listener", c.listener, "left by the server this supervisor started")) {
          c.listener = null;
          continue;
        }
        // Another server (the old "BuPulse server" task?) holds the port: never start a second one.
        if (!c.foreign) this.log(`server: port ${SERVER_PORT} is used by a process this supervisor did not start (the old "BuPulse server" task?); not starting a second server. Run admin-once.ps1 once (docs/SELF_HOST.md).`);
        c.foreign = true;
        c.state = "foreign";
        continue;
      }
      if (c.foreign) this.log(`server: port ${SERVER_PORT} is free again`);
      c.foreign = false;
      this.start(name);
    }
  }

  async healthRound() {
    if (this.stopped) return;
    const now = this.now();
    const server = this.children.server;
    if (server?.pid && server.state === "running") {
      const status = await httpStatus(`${this.localUrl}/api/status`, this.timing.probeTimeoutMs ?? 20_000, this.fetchImpl);
      if (status !== null) {
        server.lastAnswerAt = this.now();
        server.quickCrashes = 0;
        this.watch.serverSeenUp = true;
        if (!server.listener) {
          server.listener = this.listenerOf(SERVER_PORT);
          if (server.listener) this.writeState();
        }
      } else if (serverHangs({ startedAt: server.startedAt, lastAnswerAt: server.lastAnswerAt, now }, this.timing)) {
        const why = server.lastAnswerAt == null ? `no answer from ${this.localUrl}/api/status since it started ${Math.round((now - server.startedAt) / 60_000)} minutes ago` : `no answer from ${this.localUrl}/api/status for ${Math.round(this.timing.hangMs / 60_000)} minutes`;
        this.stop("server", why, { restart: true });
      }
    }
    const tunnel = this.children.tunnel;
    if (tunnel?.pid && tunnel.state === "running") {
      const status = await httpStatus(this.tunnelReadyUrl, 5_000, this.fetchImpl);
      if (status === 200) {
        tunnel.lastAnswerAt = this.now();
        tunnel.quickCrashes = 0;
      } else if (tunnelStuck({ startedAt: tunnel.startedAt, lastReadyAt: tunnel.lastAnswerAt, now }, this.timing)) {
        this.stop("tunnel", `not connected to Cloudflare for ${Math.round(this.timing.tunnelNotReadyMs / 60_000)} minutes`, { restart: true });
      }
    }
  }

  /** The public check, reported to the local server (which decides about the down and back-up messages). */
  async probeRound() {
    if (this.stopped || !this.probeOn) return;
    const now = this.now();
    const [publicStatus, localStatus, tunnelStatus] = await Promise.all([
      httpStatus(`${this.siteUrl}/api/status`, 15_000, this.fetchImpl),
      httpStatus(`${this.localUrl}/api/status`, 10_000, this.fetchImpl),
      httpStatus(this.tunnelReadyUrl, 5_000, this.fetchImpl),
    ]);
    const maintenance = this.children.server?.state === "paused" || now < this.watch.maintenanceUntil;
    const body = {
      publicOk: publicStatus === 200,
      publicStatus,
      localOk: localStatus !== null,
      tunnelReady: tunnelStatus === 200,
      maintenance,
      localDownSince: !maintenance && this.watch.localDownSince ? new Date(this.watch.localDownSince).toISOString() : null,
    };
    this.watch.last = { at: new Date(now).toISOString(), ...body };
    if (localStatus === null) {
      // The server cannot take the report; remember since when, and say it once it answers again.
      if (!maintenance && this.watch.serverSeenUp) this.watch.localDownSince ??= now;
      return;
    }
    this.watch.serverSeenUp = true;
    let secret = "";
    try {
      secret = readFileSync(this.file("cron-secret.txt"), "utf8").replace(/^﻿/, "").trim();
    } catch {
      return;
    }
    try {
      const res = await this.fetchImpl(`${this.localUrl}/api/monitor/watch`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) this.watch.localDownSince = null;
      await res.text().catch(() => "");
    } catch {
      // Tried again next minute.
    }
  }

  /**
   * The miner check: every 10 minutes the running programs and %APPDATA%\DLL. A new finding is one SECURITY line in
   * supervisor.log and one message to the owner (Telegram and email, through the local server's /api/monitor/pc-alert);
   * the same finding (name + path) again at most once in 24 hours. While the running server is older than that route
   * (until the next full deploy) the finding is only logged, and sent once a server that has it is running.
   */
  async securityRound() {
    if (this.stopped || !this.securityOn) return;
    const sec = this.security;
    const processes = await this.listProcesses();
    const now = this.now();
    if (!processes) {
      if (!sec.listFailed) this.log("miner check: the running programs could not be listed; trying again in 10 minutes");
      sec.listFailed = true;
      return;
    }
    sec.listFailed = false;
    let dllFolderExists = false;
    try {
      dllFolderExists = Boolean(this.appData) && existsSync(join(this.appData, "DLL"));
    } catch {
      // Checked again next round.
    }
    const findings = findSuspicious({ processes, appData: this.appData, dllFolderExists, windowsDir: this.windowsDir });
    sec.lastScanAt = new Date(now).toISOString();
    sec.findings = findings.map((f) => f.name);
    for (const f of dueFindings(findings, sec.logged, now, this.timing.securityRepeatMs)) {
      this.log(findingLine(f));
      sec.logged[f.key] = now;
    }
    const due = dueFindings(findings, sec.sent, now, this.timing.securityRepeatMs).slice(0, 10);
    if (!due.length) return;
    const result = await this.sendSecurityAlert(due);
    if (result === "sent") {
      for (const f of due) sec.sent[f.key] = this.now();
      this.saveSecuritySent();
      sec.lastFailure = null;
      this.log(`SECURITY: the owner was alerted about ${due.map((f) => `"${f.name}"`).join(", ")}`);
    } else if (result === "unsupported") {
      if (!sec.unsupportedLogged) this.log("SECURITY: the running server has no /api/monitor/pc-alert yet (it comes with the next full deploy): logged here only, sent once it has");
      sec.unsupportedLogged = true;
    } else if (sec.lastFailure !== result) {
      sec.lastFailure = result;
      this.log(`SECURITY: the alert could not be sent (${result}); trying again every 10 minutes`);
    }
  }

  /** "sent", "unsupported" (a server from before the route) or why it failed. Never logs the secret. */
  async sendSecurityAlert(findings) {
    let secret = "";
    try {
      secret = readFileSync(this.file("cron-secret.txt"), "utf8").replace(/^﻿/, "").trim();
    } catch {
      return "no cron-secret.txt";
    }
    if (!secret) return "cron-secret.txt is empty";
    try {
      const res = await this.fetchImpl(`${this.localUrl}/api/monitor/pc-alert`, {
        method: "POST",
        redirect: "manual",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({ kind: "suspicious-process", findings: findings.map(({ name, path, pid, memMb, looksLike, reasons }) => ({ name, path, pid, memMb, looksLike, reasons })) }),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text().catch(() => "");
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      // An older server answers 404 (or a page, not this route's JSON).
      if (res.status === 404 || (res.status >= 300 && res.status < 400) || (res.ok && json?.ok !== true)) return "unsupported";
      if (!res.ok) return `the server answered ${res.status}`;
      return json.sent ? "sent" : "no channel delivered it";
    } catch {
      return "the server did not answer";
    }
  }

  snapshot() {
    const children = {};
    for (const [name, c] of Object.entries(this.children)) {
      children[name] = { pid: c.pid, state: c.state, startedAt: c.startedIso, restarts: c.restarts, lastExit: c.lastExit, ...(c.listener ? { listener: c.listener } : {}) };
    }
    return { supervisorPid: process.pid, startedAt: this.startedAt, bootAt: bootTime(this.now()), updatedAt: new Date(this.now()).toISOString(), children, probe: this.watch.last, security: { lastScanAt: this.security.lastScanAt, findings: this.security.findings } };
  }

  writeState() {
    try {
      writeFileSync(this.file("supervisor-state.json"), JSON.stringify(this.snapshot(), null, 1));
    } catch {
      // Written again in 15 s.
    }
  }

  async shutdown() {
    if (this.stopped) return;
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    for (const name of Object.keys(this.children)) if (this.children[name].pid) this.stop(name, "supervisor stopping");
    this.writeState();
    this.log("supervisor stopped");
  }

  /** Runs the rounds on timers. Each round catches its own errors, so one failure never stops the supervisor. */
  run() {
    const safe = (fn) => async () => {
      try {
        await fn();
      } catch (error) {
        this.log(`round failed: ${error?.message ?? error}`);
      }
    };
    let busy = false;
    const control = safe(async () => {
      if (busy) return;
      busy = true;
      try {
        await this.controlRound();
      } finally {
        busy = false;
      }
    });
    this.timers.push(setInterval(control, this.timing.controlMs));
    this.timers.push(setInterval(safe(() => this.healthRound()), this.timing.healthMs));
    this.timers.push(setInterval(safe(() => this.probeRound()), this.timing.probeMs));
    this.timers.push(setInterval(() => this.writeState(), this.timing.stateMs));
    // clearInterval also clears a timeout (shutdown).
    this.timers.push(setTimeout(safe(() => this.securityRound()), this.timing.securityFirstMs));
    this.timers.push(setInterval(safe(() => this.securityRound()), this.timing.securityMs));
    return control();
  }
}

/** Holds 127.0.0.1:3019 (one supervisor at a time) and answers GET / with the state. Resolves null when it is taken. */
export async function holdLock(supervisor, port = LOCK_PORT, { waitMs = 0 } = {}) {
  const end = Date.now() + waitMs;
  for (;;) {
    const lock = await tryLock(supervisor, port);
    if (lock || Date.now() >= end) return lock;
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

function tryLock(supervisor, port) {
  return new Promise((done) => {
    // A tiny HTTP answer (one route, no body to read), so node:http is not needed.
    const server = createServer();
    server.on("connection", (socket) => {
      socket.once("data", () => {
        const body = JSON.stringify(supervisor.snapshot());
        socket.end(`HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncache-control: no-store\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`);
      });
      socket.on("error", () => socket.destroy());
      socket.setTimeout(5_000, () => socket.destroy());
    });
    server.once("error", () => done(null));
    server.listen(port, "127.0.0.1", () => done(server));
  });
}

export async function main() {
  const repo = resolve(import.meta.dirname, "../../..");
  const logs = join(homedir(), "bupulse-prod");
  mkdirSync(logs, { recursive: true });
  let config = {};
  try {
    config = JSON.parse(readFileSync(join(logs, "supervisor-config.json"), "utf8").replace(/^﻿/, ""));
  } catch {
    config = {};
  }
  const respawn = () => {
    // The replacement waits up to a minute for this one to let go of the lock.
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--wait-lock"], { cwd: repo, detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
  };
  const supervisor = new Supervisor({ logs, specs: defaultSpecs({ repo, logs, config }), respawn });
  if (process.argv.includes("--self-test")) {
    // update.ps1 runs this before asking for a fresh supervisor: the new file loads and builds its plan, starts nothing.
    const s = supervisor.snapshot();
    console.log(`supervisor self-test ok: ${Object.keys(s.children).join(", ")}`);
    return 0;
  }
  if (existsSync(join(logs, "stop-supervisor"))) {
    supervisor.log("not starting: stop-supervisor exists (delete it to let the supervisor run)");
    return 0;
  }
  const lock = await holdLock(supervisor, LOCK_PORT, { waitMs: process.argv.includes("--wait-lock") ? 60_000 : 0 });
  if (!lock) return 0; // Another supervisor runs (the boot task and the logon task both try): nothing to do.
  supervisor.log(`supervisor started: pid ${process.pid}, node ${process.version}`);
  supervisor.stopLeftovers();
  const bye = async () => {
    await supervisor.shutdown();
    lock.close();
    process.exit(0);
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) process.on(signal, bye);
  process.on("uncaughtException", (error) => supervisor.log(`unexpected error: ${error?.message ?? error}`));
  process.on("unhandledRejection", (error) => supervisor.log(`unexpected error: ${error?.message ?? error}`));
  await supervisor.run();
  // Stays alive on its timers; returns only when stop-supervisor stops it.
  await new Promise((done) => {
    const t = setInterval(() => {
      if (supervisor.stopped) {
        clearInterval(t);
        lock.close();
        done();
      }
    }, 1_000);
  });
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`supervisor failed: ${error?.message ?? error}`);
      process.exit(1);
    },
  );
}
