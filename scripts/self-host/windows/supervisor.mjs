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
//   as alive: a 503 because the database is down is not fixed by a restart) for 2 minutes, after a 6-minute start grace.
// - The tunnel is restarted when cloudflared's own /ready (metrics on 127.0.0.1:20249) has said "not ready" for 5 minutes.
// - Every stop is by the exact process ID it started (taskkill /PID <pid> /T /F: that process and its children), never by
//   process name. A piece left running by a previous supervisor (killed hard) is stopped only when Windows confirms its
//   start time is the one recorded for it. Each start, exit and restart is one line in supervisor.log.
// - Every minute it checks https://bupulse.com/api/status from outside (internet, Cloudflare, the tunnel) and reports it
//   to the local server (POST /api/monitor/watch, Bearer: this PC's cron-secret.txt), which sends the owner ONE Telegram
//   and email message when the site has been down for 2 minutes and one when it is back (lib/monitor/watch.ts).
//
// Control files in %USERPROFILE%\bupulse-prod (update.ps1 uses them; no admin needed):
//   pause-server       stop the server and keep it stopped (while update.ps1 builds); delete it to start again
//   restart-server     restart-tunnel     restart-jobs     restart that piece once (the file is removed)
//   jobs-on            run the jobs loop (the scheduled jobs must run on ONE computer only)
//   restart-supervisor stop the pieces and start a fresh supervisor (update.ps1, when supervisor.mjs changed)
//   stop-supervisor    stop everything and exit; while it exists the supervisor does not start
//
// One supervisor at a time: it holds 127.0.0.1:3019, which also answers GET / with its state as JSON (no secrets).
// State is also written to supervisor-state.json every 15 s (the heartbeat in cron-loop.ps1 reads it).
//
//   node scripts/self-host/windows/supervisor.mjs          (Task Scheduler runs it: setup-supervisor.ps1, admin-once.ps1)

import { spawn, spawnSync } from "node:child_process";
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
  /** No answer at all from the server for this long: it hangs, restart it. */
  hangMs: 2 * 60_000,
  /** cloudflared not ready for this long: restart it. */
  tunnelNotReadyMs: 5 * 60_000,
  /** A piece that ran at least this long starts again without waiting next time. */
  healthyRunMs: 10 * 60_000,
  /** A piece that exits sooner than this counts as a quick crash (the wait doubles). */
  quickCrashMs: 60_000,
  /** How often supervisor-state.json is written. */
  stateMs: 15_000,
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
   * @param {string} [o.localUrl]     http://127.0.0.1:3002
   * @param {string} [o.siteUrl]      https://bupulse.com
   * @param {string} [o.tunnelReadyUrl]
   * @param {boolean} [o.probe]       report the public check to the local server (off in most tests)
   * @param {() => void} [o.respawn]  starts a fresh supervisor (restart-supervisor)
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
    this.localUrl = o.localUrl ?? `http://127.0.0.1:${SERVER_PORT}`;
    this.siteUrl = o.siteUrl ?? SITE_URL;
    this.tunnelReadyUrl = o.tunnelReadyUrl ?? `http://${TUNNEL_METRICS}/ready`;
    this.probeOn = o.probe ?? true;
    this.respawn = o.respawn ?? null;
    this.startedAt = new Date(this.now()).toISOString();
    this.children = Object.fromEntries(
      NAMES.filter((n) => this.specs[n]).map((n) => [n, { pid: null, proc: null, state: "stopped", startedAt: 0, startedIso: null, quickCrashes: 0, nextStartAt: 0, restarts: 0, lastExit: null, mode: null, lastAnswerAt: null, foreign: false }]),
    );
    // serverSeenUp: the server answered at least once since this supervisor started, so a later silence is an outage
    // (the supervisor's own first start after a reboot is not: the uptime record covers a PC that was off).
    this.watch = { localDownSince: null, maintenanceUntil: 0, last: null, serverSeenUp: false };
    this.timers = [];
    this.stopped = false;
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
  wanted() {
    return {
      server: !existsSync(this.file("pause-server")),
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
    for (const name of NAMES) {
      const old = prev.children?.[name];
      if (!old?.pid || !old.startedAt || !isAlive(old.pid)) continue;
      const actual = this.startedAtOf(old.pid);
      if (!sameStart(old.startedAt, actual)) {
        this.log(`leftover ${name}: pid ${old.pid} is alive but is not the process the last supervisor started; left alone`);
        continue;
      }
      this.log(`leftover ${name}: stopping pid ${old.pid}, started by the previous supervisor at ${old.startedAt}`);
      this.kill(old.pid);
    }
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
      if (name === "server" && (await this.portBusy(SERVER_PORT))) {
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
      const status = await httpStatus(`${this.localUrl}/api/status`, 10_000, this.fetchImpl);
      if (status !== null) {
        server.lastAnswerAt = this.now();
        server.quickCrashes = 0;
        this.watch.serverSeenUp = true;
      } else if (serverHangs({ startedAt: server.startedAt, lastAnswerAt: server.lastAnswerAt, now }, this.timing)) {
        this.stop("server", `no answer from ${this.localUrl}/api/status for ${Math.round(this.timing.hangMs / 60_000)} minutes`, { restart: true });
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

  snapshot() {
    const children = {};
    for (const [name, c] of Object.entries(this.children)) {
      children[name] = { pid: c.pid, state: c.state, startedAt: c.startedIso, restarts: c.restarts, lastExit: c.lastExit };
    }
    return { supervisorPid: process.pid, startedAt: this.startedAt, bootAt: bootTime(this.now()), updatedAt: new Date(this.now()).toISOString(), children, probe: this.watch.last };
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
