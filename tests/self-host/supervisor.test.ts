import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { afterExit, backoffMs, dueFindings, findSuspicious, holdLock, lookAlikeOf, parseProcessList, sameStart, serverHangs, Supervisor, tunnelStuck, TIMING } from "@/scripts/self-host/windows/supervisor.mjs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 8_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(50);
  }
  return check();
}

describe("restart arithmetic", () => {
  it("waits 5 s, then doubles while a piece keeps crashing, up to 5 minutes", () => {
    expect(backoffMs(0)).toBe(5_000);
    expect(backoffMs(1)).toBe(10_000);
    expect(backoffMs(3)).toBe(40_000);
    expect(backoffMs(20)).toBe(300_000);
  });

  it("counts quick crashes and forgets them after a long healthy run", () => {
    expect(afterExit({ startedAt: 0, exitedAt: 2_000, quickCrashes: 2 })).toMatchObject({ quickCrashes: 3, waitMs: 40_000 });
    expect(afterExit({ startedAt: 0, exitedAt: 11 * 60_000, quickCrashes: 5 })).toMatchObject({ quickCrashes: 0, waitMs: 5_000 });
    // Between a minute and ten: neither quick nor healthy, the count stays.
    expect(afterExit({ startedAt: 0, exitedAt: 5 * 60_000, quickCrashes: 2 })).toMatchObject({ quickCrashes: 2, waitMs: 20_000 });
  });

  it("calls the server hung only after its start grace and 5 minutes without any answer", () => {
    const g = TIMING.startGraceMs;
    expect(serverHangs({ startedAt: 0, lastAnswerAt: null, now: g - 1 })).toBe(false);
    expect(serverHangs({ startedAt: 0, lastAnswerAt: null, now: g + 120_000 })).toBe(false);
    expect(serverHangs({ startedAt: 0, lastAnswerAt: null, now: g + 300_000 })).toBe(true);
    expect(serverHangs({ startedAt: 0, lastAnswerAt: g + 100_000, now: g + 380_000 })).toBe(false);
    expect(serverHangs({ startedAt: 0, lastAnswerAt: g + 100_000, now: g + 400_000 })).toBe(true);
  });

  it("calls the tunnel stuck after 5 minutes not ready", () => {
    expect(tunnelStuck({ startedAt: 0, lastReadyAt: null, now: 4 * 60_000 })).toBe(false);
    expect(tunnelStuck({ startedAt: 0, lastReadyAt: null, now: 5 * 60_000 })).toBe(true);
    expect(tunnelStuck({ startedAt: 0, lastReadyAt: 3 * 60_000, now: 6 * 60_000 })).toBe(false);
  });

  it("confirms a leftover process only by its recorded start time", () => {
    expect(sameStart("2026-11-13T08:00:00.000Z", "2026-11-13T08:00:03.100Z")).toBe(true);
    expect(sameStart("2026-11-13T08:00:00.000Z", "2026-11-13T09:00:00.000Z")).toBe(false);
    expect(sameStart("2026-11-13T08:00:00.000Z", null)).toBe(false);
  });
});

describe("the supervisor with real child processes", () => {
  let dir = "";
  let sup: InstanceType<typeof Supervisor> | null = null;
  afterEach(async () => {
    await sup?.shutdown();
    sup = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const fast = { controlMs: 50, healthMs: 60_000, probeMs: 60_000, stateMs: 60_000, quickCrashMs: 60_000, healthyRunMs: 600_000 };
  const spec = (code: string) => ({ cmd: process.execPath, args: ["-e", code], cwd: process.cwd(), log: "" });
  function make(specs: Record<string, ReturnType<typeof spec>>, extra: Record<string, unknown> = {}) {
    dir = mkdtempSync(join(tmpdir(), "bp-sup-"));
    for (const s of Object.values(specs)) s.log = join(dir, "child.log");
    const kills: number[] = [];
    sup = new Supervisor({
      logs: dir,
      specs,
      timing: fast,
      probe: false,
      portBusy: async () => false,
      kill: (pid: number) => {
        kills.push(pid);
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          process.kill(pid, "SIGKILL");
        }
      },
      ...extra,
    });
    return { kills, log: () => (existsSync(join(dir, "supervisor.log")) ? readFileSync(join(dir, "supervisor.log"), "utf8") : "") };
  }

  it("starts a piece that crashed again, and logs it", async () => {
    const { log } = make({ tunnel: spec("setTimeout(() => process.exit(3), 100)") });
    // No crash wait in the test: the next start is due at once.
    sup!.timing.quickCrashMs = 0;
    await sup!.controlRound();
    const first = sup!.children.tunnel.pid;
    expect(first).toBeTruthy();
    await until(() => sup!.children.tunnel.pid === null);
    expect(log()).toMatch(/exit tunnel: pid \d+ ended by itself \(code 3\)/);
    sup!.children.tunnel.nextStartAt = 0;
    await sup!.controlRound();
    expect(sup!.children.tunnel.pid).toBeTruthy();
    expect(sup!.children.tunnel.pid).not.toBe(first);
    expect(sup!.children.tunnel.restarts).toBe(1);
  });

  it("waits longer after each quick crash", async () => {
    make({ tunnel: spec("process.exit(1)") });
    await sup!.controlRound();
    await until(() => sup!.children.tunnel.state === "restarting");
    const c = sup!.children.tunnel;
    expect(c.quickCrashes).toBe(1);
    expect(c.nextStartAt - Date.now()).toBeGreaterThan(5_000);
    // Not started again before its time.
    await sup!.controlRound();
    expect(c.pid).toBeNull();
  });

  it("stops the server by its own PID on pause-server and starts it again when the file goes", async () => {
    const { kills, log } = make({ server: spec("setInterval(() => {}, 1000)") });
    await sup!.controlRound();
    const pid = sup!.children.server.pid!;
    writeFileSync(join(dir, "pause-server"), "");
    await sup!.controlRound();
    expect(kills).toEqual([pid]);
    await until(() => sup!.children.server.pid === null);
    await sup!.controlRound();
    expect(sup!.children.server.state).toBe("paused");
    expect(log()).toMatch(/stopping server: pid \d+ \(pause-server\)/);
    rmSync(join(dir, "pause-server"));
    await sup!.controlRound();
    expect(sup!.children.server.pid).toBeTruthy();
    expect(sup!.children.server.pid).not.toBe(pid);
    // A planned stop is not an outage.
    expect(sup!.watch.localDownSince).toBeNull();
  });

  it("restarts a piece once when its restart file appears, and removes the file", async () => {
    const { kills } = make({ jobs: spec("setInterval(() => {}, 1000)") });
    writeFileSync(join(dir, "jobs-on"), "");
    await sup!.controlRound();
    const pid = sup!.children.jobs.pid!;
    writeFileSync(join(dir, "restart-jobs"), "");
    await sup!.controlRound();
    expect(existsSync(join(dir, "restart-jobs"))).toBe(false);
    expect(kills).toEqual([pid]);
    await until(() => sup!.children.jobs.pid === null);
    await sup!.controlRound();
    expect(sup!.children.jobs.pid).toBeTruthy();
    expect(sup!.children.jobs.pid).not.toBe(pid);
  });

  it("runs the jobs loop only while jobs-on exists", async () => {
    make({ jobs: spec("setInterval(() => {}, 1000)") });
    await sup!.controlRound();
    expect(sup!.children.jobs.pid).toBeNull();
    expect(sup!.children.jobs.state).toBe("off");
    writeFileSync(join(dir, "jobs-on"), "");
    await sup!.controlRound();
    expect(sup!.children.jobs.pid).toBeTruthy();
    rmSync(join(dir, "jobs-on"));
    await sup!.controlRound();
    await until(() => sup!.children.jobs.pid === null);
    expect(sup!.children.jobs.pid).toBeNull();
  });

  it("never starts a second server while another process holds the port", async () => {
    const { log } = make({ server: spec("setInterval(() => {}, 1000)") }, { portBusy: async () => true });
    await sup!.controlRound();
    await sup!.controlRound();
    expect(sup!.children.server.pid).toBeNull();
    expect(sup!.children.server.state).toBe("foreign");
    expect(log().match(/not starting a second server/g)).toHaveLength(1);
  });

  it("ignores (and logs once) a pause-server left for more than 45 minutes by a failed update", async () => {
    const { log } = make({ server: spec("setInterval(() => {}, 1000)") });
    writeFileSync(join(dir, "pause-server"), "");
    const old = new Date(Date.now() - 46 * 60_000);
    utimesSync(join(dir, "pause-server"), old, old);
    await sup!.controlRound();
    await sup!.controlRound();
    expect(sup!.children.server.pid).toBeTruthy();
    expect(log().match(/pause-server is older than 45 minutes/g)).toHaveLength(1);
  });

  it("never starts the jobs loop while port 3002 belongs to a server it did not start (the old tasks)", async () => {
    let busy = true;
    const { log } = make({ server: spec("setInterval(() => {}, 1000)"), jobs: spec("setInterval(() => {}, 1000)") }, { portBusy: async () => busy, listenerOf: () => null });
    writeFileSync(join(dir, "jobs-on"), "");
    await sup!.controlRound();
    await sup!.controlRound();
    expect(sup!.children.jobs.pid).toBeNull();
    expect(sup!.children.jobs.state).toBe("waiting");
    expect(log().match(/jobs: not starting/g)).toHaveLength(1);
    // The old server goes away: ours starts, and then the jobs loop.
    busy = false;
    await sup!.controlRound();
    expect(sup!.children.server.pid).toBeTruthy();
    expect(sup!.children.jobs.pid).toBeTruthy();
  });

  it("records the server's listener and stops it as an orphan only when its start time matches", async () => {
    const orphan = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
    const recorded = { pid: orphan.pid!, startedAt: "2026-11-13T08:00:00.000Z" };
    let startTimeWindowsReports = "2026-11-13T09:30:00.000Z"; // a different process reusing the PID
    let busy = false;
    const { kills, log } = make(
      { server: spec("setInterval(() => {}, 1000)") },
      { portBusy: async () => busy, listenerOf: () => recorded, startedAtOf: () => startTimeWindowsReports, fetchImpl: async () => new Response("{}", { status: 200 }) },
    );
    await sup!.controlRound();
    await sup!.healthRound();
    expect(sup!.children.server.listener).toEqual(recorded);
    expect((sup!.snapshot().children as Record<string, { listener?: unknown }>).server.listener).toEqual(recorded);
    // server.mjs dies by itself, its `next start` keeps the port.
    const serverPid = sup!.children.server.pid!;
    process.kill(-serverPid, "SIGKILL");
    await until(() => sup!.children.server.pid === null);
    sup!.children.server.nextStartAt = 0;
    busy = true;
    await sup!.controlRound();
    // Start time does not match: left alone, no second server.
    expect(kills).not.toContain(orphan.pid);
    expect(sup!.children.server.state).toBe("foreign");
    // It matches: stopped by that PID, and ours starts once the port is free.
    startTimeWindowsReports = "2026-11-13T08:00:02.000Z";
    await sup!.controlRound();
    expect(kills).toContain(orphan.pid);
    expect(log()).toMatch(/leftover server listener: stopping pid \d+/);
    busy = false;
    await sup!.controlRound();
    expect(sup!.children.server.pid).toBeTruthy();
  });

  it("restarts a hung server (no answer for 5 minutes after the grace) by its PID", async () => {
    const { kills, log } = make({ server: spec("setInterval(() => {}, 1000)") }, { fetchImpl: async () => Promise.reject(new Error("no answer")) });
    await sup!.controlRound();
    const pid = sup!.children.server.pid!;
    // Pretend it started long ago.
    sup!.children.server.startedAt = Date.now() - TIMING.startGraceMs - TIMING.hangMs - 1_000;
    await sup!.healthRound();
    expect(kills).toEqual([pid]);
    expect(log()).toMatch(/restarting server: pid \d+ \(no answer from/);
    await until(() => sup!.children.server.pid === null);
    await sup!.controlRound();
    expect(sup!.children.server.pid).toBeTruthy();
  });

  it("leaves a server that answers (even 503) alone", async () => {
    const { kills } = make({ server: spec("setInterval(() => {}, 1000)") }, { fetchImpl: async () => new Response("down", { status: 503 }) });
    await sup!.controlRound();
    sup!.children.server.startedAt = Date.now() - TIMING.startGraceMs - TIMING.hangMs - 1_000;
    await sup!.healthRound();
    expect(kills).toEqual([]);
  });

  it("stops everything on stop-supervisor", async () => {
    const { kills } = make({ server: spec("setInterval(() => {}, 1000)"), tunnel: spec("setInterval(() => {}, 1000)") });
    await sup!.controlRound();
    const pids = [sup!.children.server.pid, sup!.children.tunnel.pid];
    writeFileSync(join(dir, "stop-supervisor"), "");
    await sup!.controlRound();
    expect(sup!.stopped).toBe(true);
    expect(kills.sort()).toEqual(pids.sort());
  });
});

describe("the public check reported to the local server", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("posts the result with this PC's secret, and remembers since when the server could not take it", async () => {
    dir = mkdtempSync(join(tmpdir(), "bp-sup-"));
    writeFileSync(join(dir, "cron-secret.txt"), "pc-secret\n");
    const posts: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
    let localUp = false;
    let now = 1_000_000;
    const sup = new Supervisor({
      logs: dir,
      specs: {},
      probe: true,
      now: () => now,
      siteUrl: "https://site.test",
      localUrl: "http://local.test",
      tunnelReadyUrl: "http://tunnel.test/ready",
      fetchImpl: (async (url: string, init?: RequestInit) => {
        if (url === "http://local.test/api/monitor/watch") {
          posts.push({ url, auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) });
          return new Response("{}", { status: 200 });
        }
        if (url.startsWith("http://local.test")) return localUp ? new Response("{}", { status: 200 }) : Promise.reject(new Error("refused"));
        if (url.startsWith("https://site.test")) return new Response("bad gateway", { status: 502 });
        return new Response("", { status: 503 });
      }) as typeof fetch,
    });
    // Right after the supervisor's own start the server not answering yet is not an outage.
    await sup.probeRound();
    expect(sup.watch.localDownSince).toBeNull();
    // Once it has answered, a silence is.
    sup.watch.serverSeenUp = true;
    await sup.probeRound();
    expect(posts).toHaveLength(0);
    expect(sup.watch.localDownSince).toBe(1_000_000);
    now += 180_000;
    localUp = true;
    await sup.probeRound();
    expect(posts).toHaveLength(1);
    expect(posts[0].auth).toBe("Bearer pc-secret");
    expect(posts[0].body).toMatchObject({ publicOk: false, publicStatus: 502, localOk: true, tunnelReady: false, maintenance: false, localDownSince: new Date(1_000_000).toISOString() });
    // Delivered: forgotten.
    expect(sup.watch.localDownSince).toBeNull();
  });
});

describe("one supervisor at a time", () => {
  it("the second one cannot take the lock, and the lock answers with the state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bp-sup-"));
    const sup = new Supervisor({ logs: dir, specs: {}, probe: false });
    const port = 39_000 + Math.floor(Math.random() * 500);
    const first = await holdLock(sup, port);
    expect(first).not.toBeNull();
    expect(await holdLock(sup, port)).toBeNull();
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const state = (await res.json()) as { supervisorPid: number };
    expect(state.supervisorPid).toBe(process.pid);
    first!.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("the miner check (the fake dlIhost of 17 November 2026)", () => {
  const appData = "C:\\Users\\WECPC015\\AppData\\Roaming";
  const proc = (name: string, path: string | null = null, privateBytes = 50 * 1024 ** 2, pid = 100) => ({ pid, name, path, privateBytes });
  const GB = 1024 ** 3;

  it("flags names that imitate Windows programs, never the real ones in any case", () => {
    expect(lookAlikeOf("dlIhost.exe")).toBe("dllhost");
    expect(lookAlikeOf("dlIhost")).toBe("dllhost");
    expect(lookAlikeOf("svch0st")).toBe("svchost");
    expect(lookAlikeOf("expl0rer.exe")).toBe("explorer");
    expect(lookAlikeOf("wlnlogon")).toBe("winlogon");
    for (const real of ["dllhost", "dllhost.exe", "RuntimeBroker.exe", "RuntimeBroker", "SearchHost.exe", "svchost", "explorer.EXE", "WmiPrvSE.exe", "chrome", "node.exe"]) expect(lookAlikeOf(real)).toBeNull();
  });

  it("finds the miner: look-alike name, in AppData\\Roaming\\DLL, 2.35 GB", () => {
    const miner = proc("dlIhost.exe", `${appData}\\DLL\\dlIhost.exe`, 2.35 * GB, 4242);
    const found = findSuspicious({ processes: [proc("dllhost.exe"), proc("RuntimeBroker.exe", "C:\\Windows\\System32\\RuntimeBroker.exe"), proc("SearchHost.exe"), miner], appData });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: "dlIhost", pid: 4242, looksLike: "dllhost", reasons: ["lookalike", "dll-path", "memory"] });
    expect(found[0].key).toBe("dlihost|c:\\users\\wecpc015\\appdata\\roaming\\dll\\dlihost.exe");
  });

  it("flags anything under AppData\\Roaming\\DLL, a Windows name outside Windows, the folder, and big unknown programs", () => {
    const found = findSuspicious({
      processes: [
        proc("helper.exe", `${appData.toLowerCase()}/dll/helper.exe`),
        proc("svchost.exe", `${appData}\\Microsoft\\svchost.exe`),
        proc("svchost.exe", "C:\\Windows\\System32\\svchost.exe"),
        proc("xmrig.exe", "C:\\Temp\\xmrig.exe", 3 * GB),
        proc("node.exe", "C:\\Program Files\\nodejs\\node.exe", 3 * GB),
        proc("MsMpEng.exe", null, 3 * GB),
        proc("other.exe", `${appData}\\DLLs\\other.exe`),
      ],
      appData,
      dllFolderExists: true,
    });
    expect(found.map((f: { name: string; reasons: string[] }) => [f.name, f.reasons])).toEqual([
      ["helper", ["dll-path"]],
      ["svchost", ["system-name-path"]],
      ["xmrig", ["memory"]],
      ["DLL folder", ["dll-folder"]],
    ]);
  });

  it("finds nothing on a clean PC", () => {
    expect(findSuspicious({ processes: [proc("dllhost.exe"), proc("RuntimeBroker.exe"), proc("SearchHost.exe"), proc("chrome.exe", null, 3 * GB)], appData })).toEqual([]);
  });

  it("reads PowerShell's list, also when it is one process", () => {
    expect(parseProcessList('[{"pid":4,"name":"System","path":null,"priv":0},{"pid":9,"name":"dlIhost.exe","path":"C:\\\\x.exe","priv":10}]')).toEqual([
      { pid: 4, name: "System", path: null, privateBytes: 0 },
      { pid: 9, name: "dlIhost.exe", path: "C:\\x.exe", privateBytes: 10 },
    ]);
    expect(parseProcessList('{"pid":9,"name":"a.exe","path":"","priv":1}')).toEqual([{ pid: 9, name: "a.exe", path: null, privateBytes: 1 }]);
    expect(parseProcessList("not json")).toBeNull();
  });

  it("sends a finding once, then again only after 24 hours", () => {
    const f = [{ key: "dlihost|x" }, { key: "folder|y" }];
    const day = TIMING.securityRepeatMs;
    expect(dueFindings(f, {}, 1_000)).toEqual(f);
    expect(dueFindings(f, { "dlihost|x": 1_000 }, 1_000 + 10 * 60_000)).toEqual([{ key: "folder|y" }]);
    expect(dueFindings(f, { "dlihost|x": 1_000, "folder|y": 1_000 }, 1_000 + day - 1)).toEqual([]);
    expect(dueFindings(f, { "dlihost|x": 1_000, "folder|y": 1_000 + day }, 1_000 + day)).toEqual([{ key: "dlihost|x" }]);
  });

  describe("in the supervisor", () => {
    let dir = "";
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });
    const miner = { pid: 4242, name: "dlIhost.exe", path: `${appData}\\DLL\\dlIhost.exe`, privateBytes: 2.35 * GB };
    function make(answer: (url: string, init?: RequestInit) => Response | Promise<Response>, startAt = Date.UTC(2026, 10, 17, 10)) {
      dir = mkdtempSync(join(tmpdir(), "bp-sec-"));
      writeFileSync(join(dir, "cron-secret.txt"), "pc-secret\n");
      const calls: { url: string; body: { findings: { name: string; reasons: string[] }[] }; auth: string }[] = [];
      let now = startAt;
      const sup = new Supervisor({
        logs: dir,
        specs: {},
        probe: false,
        security: true,
        appData,
        now: () => now,
        listProcesses: async () => [{ pid: 1, name: "dllhost.exe", path: null, privateBytes: 0 }, miner],
        fetchImpl: (async (url: string, init?: RequestInit) => {
          calls.push({ url, body: JSON.parse(String(init?.body)), auth: String((init?.headers as Record<string, string>).authorization) });
          return answer(url, init);
        }) as typeof fetch,
      });
      const log = () => (existsSync(join(dir, "supervisor.log")) ? readFileSync(join(dir, "supervisor.log"), "utf8") : "");
      return { sup, calls, log, advance: (ms: number) => (now += ms) };
    }

    it("logs and alerts the owner once, again after 24 hours, and remembers it across a restart", async () => {
      const ok = () => new Response(JSON.stringify({ ok: true, sent: true }), { status: 200 });
      const { sup, calls, log, advance } = make(ok);
      await sup.securityRound();
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("http://127.0.0.1:3002/api/monitor/pc-alert");
      expect(calls[0].auth).toBe("Bearer pc-secret");
      expect(calls[0].body.findings).toEqual([expect.objectContaining({ name: "dlIhost", reasons: ["lookalike", "dll-path", "memory"] })]);
      expect(log()).toMatch(/SECURITY: suspicious program "dlIhost" \(looks like Windows "dllhost"; runs from %APPDATA%\\DLL; 2406 MB private memory\) pid 4242/);
      expect(log()).toMatch(/the owner was alerted about "dlIhost"/);
      expect(log()).not.toContain("pc-secret");
      advance(10 * 60_000);
      await sup.securityRound();
      expect(calls).toHaveLength(1);
      expect(log().match(/SECURITY: suspicious/g)).toHaveLength(1);
      // A fresh supervisor (update, restart) does not tell again.
      const again = new Supervisor({ logs: dir, specs: {}, probe: false, security: true, appData, now: () => Date.UTC(2026, 10, 17, 12), listProcesses: async () => [miner], fetchImpl: sup.fetchImpl });
      await again.securityRound();
      expect(calls).toHaveLength(1);
      advance(TIMING.securityRepeatMs);
      await sup.securityRound();
      expect(calls).toHaveLength(2);
    });

    it("an older server without the route: logged only (once), and sent once a server has it", async () => {
      let supported = false;
      const { sup, calls, log, advance } = make(() => (supported ? new Response(JSON.stringify({ ok: true, sent: true })) : new Response("<html>not found</html>", { status: 404 })));
      await sup.securityRound();
      advance(10 * 60_000);
      await sup.securityRound();
      expect(calls).toHaveLength(2);
      expect(log().match(/has no \/api\/monitor\/pc-alert yet/g)).toHaveLength(1);
      expect(log().match(/SECURITY: suspicious/g)).toHaveLength(1);
      supported = true;
      advance(10 * 60_000);
      await sup.securityRound();
      expect(log()).toMatch(/the owner was alerted/);
      advance(10 * 60_000);
      await sup.securityRound();
      expect(calls).toHaveLength(3);
    });

    it("a page instead of the route's JSON counts as an older server; a failed delivery is tried again", async () => {
      let answer: () => Response = () => new Response("<html></html>", { status: 200 });
      const { sup, calls, log, advance } = make(() => answer());
      await sup.securityRound();
      expect(log()).toMatch(/has no \/api\/monitor\/pc-alert yet/);
      answer = () => new Response(JSON.stringify({ ok: true, sent: false }));
      advance(10 * 60_000);
      await sup.securityRound();
      expect(log()).toMatch(/could not be sent \(no channel delivered it\)/);
      advance(10 * 60_000);
      await sup.securityRound();
      expect(calls).toHaveLength(3);
    });

    it("sends nothing on a clean PC", async () => {
      const { sup, calls, log } = make(() => new Response("{}"));
      sup.listProcesses = async () => [{ pid: 1, name: "dllhost.exe", path: null, privateBytes: 0 }, { pid: 2, name: "RuntimeBroker.exe", path: "C:\\Windows\\System32\\RuntimeBroker.exe", privateBytes: 0 }];
      await sup.securityRound();
      expect(calls).toHaveLength(0);
      expect(log()).toBe("");
      expect(sup.snapshot().security.lastScanAt).toBeTruthy();
    });
  });
});
