// Automatic failover for bupulse.com (17 November 2026: the office PC stopped answering overnight and the site was down
// for 6 hours before anyone noticed). Runs on the Mac (launchd, scripts/self-host/mac-failover/install.sh):
//
// - every minute it asks the PC (https://pc.bupulse.com/api/status, a hostname only the PC's tunnel serves) and the
//   Mac's standby server (http://127.0.0.1:3002/api/status) whether they answer;
// - when the PC has not answered for 5 minutes and the Mac does, the five public hostnames are pointed at the Mac's
//   tunnel (bupulse-studio) through Cloudflare's DNS API; when the PC has answered for 60 minutes again, they go back
//   (doubled, up to 8 hours, each time the PC fails again within an hour of getting the site back);
// - each switch is one line in ~/bupulse-prod/failover.log and one Telegram note (gh workflow run notify-owner.yml).
//
// The Mac's standby server runs with its own CRON_SECRET (serve.mjs), so no scheduled job runs on the Mac: nothing is
// posted twice, and scheduled posts wait until the PC serves the site again. A database outage makes both fail, so it
// never causes a switch. The Cloudflare token (DNS edit for bupulse.com only) is read from the Mac's Keychain
// ("BuPulse Cloudflare DNS") and never printed or written anywhere.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HOSTS = ["bupulse.com", "www.bupulse.com", "marketing.bupulse.com", "admin.bupulse.com", "support.bupulse.com"];
export const TARGET = {
  pc: "cf9eb6ae-8290-4e87-8c8e-fc6e0c3375d0.cfargotunnel.com",
  mac: "b89e6e54-6a63-427c-b348-0e6a2dbdd37f.cfargotunnel.com",
};
export const TIMING = {
  /** How often both servers are asked. */
  checkMs: 60_000,
  /** The PC silent this long (and the Mac answering): switch to the Mac. */
  failAfterMs: 5 * 60_000,
  /** The PC answering this long again: switch back. 60 minutes, not 10: on 17 November the PC answered the watcher for
   * 10 minutes, took the site back and failed under real traffic 2 minutes later. */
  recoverAfterMs: 60 * 60_000,
  /** A PC that fails again within this long after getting the site back doubles the next wait (up to maxRecoverMs). */
  relapseWindowMs: 60 * 60_000,
  maxRecoverMs: 8 * 60 * 60_000,
  /** How long one health check waits (the PC's first answer after a restart is slow). */
  probeTimeoutMs: 30_000,
};

/**
 * The next state and whether to switch. `state.serving` is "pc" or "mac"; `pcBadSince`/`pcGoodSince` are the times the
 * current run of failed/good PC answers started (null when there is none); `recoverMs` is how long the PC must answer
 * before it gets the site back (doubled after each relapse); `backAt` is when the site last went back to the PC.
 */
export function decide(state, { pcOk, macOk, now }, timing = TIMING) {
  const recoverMs = state.recoverMs ?? timing.recoverAfterMs;
  const next = { ...state, recoverMs };
  if (state.serving === "pc") {
    next.pcGoodSince = null;
    if (pcOk) {
      next.pcBadSince = null;
      return { state: next, switchTo: null };
    }
    next.pcBadSince = state.pcBadSince ?? now;
    if (macOk && now - next.pcBadSince >= timing.failAfterMs) {
      const relapse = state.backAt != null && now - state.backAt < timing.relapseWindowMs;
      const nextRecover = relapse ? Math.min(recoverMs * 2, timing.maxRecoverMs) : timing.recoverAfterMs;
      return { state: { serving: "mac", pcBadSince: null, pcGoodSince: null, recoverMs: nextRecover, backAt: state.backAt ?? null }, switchTo: "mac" };
    }
    return { state: next, switchTo: null };
  }
  next.pcBadSince = null;
  if (!pcOk) {
    next.pcGoodSince = null;
    return { state: next, switchTo: null };
  }
  next.pcGoodSince = state.pcGoodSince ?? now;
  if (now - next.pcGoodSince >= recoverMs) return { state: { serving: "pc", pcBadSince: null, pcGoodSince: null, recoverMs, backAt: now }, switchTo: "pc" };
  return { state: next, switchTo: null };
}

/** Which side the apex record points at now ("pc", "mac" or null when it is neither). */
export function servingOf(content) {
  if (content === TARGET.pc) return "pc";
  if (content === TARGET.mac) return "mac";
  return null;
}

async function healthy(url, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(url, { headers: { "cache-control": "no-cache", "user-agent": "BuPulse failover" }, signal: AbortSignal.timeout(TIMING.probeTimeoutMs) });
    return res.status === 200;
  } catch {
    return false;
  }
}

function createDns(token, zoneId, fetchImpl = fetch) {
  const api = async (path, init = {}) => {
    const res = await fetchImpl(`https://api.cloudflare.com/client/v4/zones/${zoneId}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) throw new Error(`Cloudflare ${res.status}: ${(body.errors ?? []).map((e) => e.message).join("; ") || "no answer"}`);
    return body.result;
  };
  const recordOf = async (name) => {
    const [record] = await api(`/dns_records?type=CNAME&name=${encodeURIComponent(name)}`);
    if (!record) throw new Error(`no CNAME record for ${name}`);
    return record;
  };
  return {
    async serving() {
      return servingOf((await recordOf(HOSTS[0])).content);
    },
    async pointAll(side) {
      for (const name of HOSTS) {
        const record = await recordOf(name);
        if (record.content !== TARGET[side]) await api(`/dns_records/${record.id}`, { method: "PATCH", body: JSON.stringify({ content: TARGET[side], proxied: true }) });
      }
    },
  };
}

async function main() {
  const dir = join(homedir(), "bupulse-prod");
  mkdirSync(dir, { recursive: true });
  const log = (line) => appendFileSync(join(dir, "failover.log"), `${new Date().toISOString()} ${line}\n`);
  const notify = (text) => {
    try {
      execFileSync("gh", ["workflow", "run", "notify-owner.yml", "-R", "bupulse/Marketing-Agency-AI-App", "-f", `text=${text}`], { stdio: "ignore", timeout: 60_000 });
    } catch {
      log("Telegram note could not be sent (gh)");
    }
  };
  const config = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
  const token = execFileSync("security", ["find-generic-password", "-s", "BuPulse Cloudflare DNS", "-a", "bupulse", "-w"], { encoding: "utf8" }).trim();
  // The zone ID by its name (the token may read the zone it edits), else the one in config.json.
  const zoneId = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${config.zoneName}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })
    .then((r) => r.json())
    .then((b) => b?.result?.[0]?.id ?? config.zoneId)
    .catch(() => config.zoneId);
  const dns = createDns(token, zoneId);
  const stateFile = join(dir, "failover-state.json");

  let serving = await dns.serving().catch((e) => (log(`reading DNS failed: ${e.message}`), null));
  let saved = {};
  try {
    saved = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    // First start.
  }
  let state = { serving: serving ?? "pc", pcBadSince: null, pcGoodSince: null, recoverMs: saved.recoverMs ?? TIMING.recoverAfterMs, backAt: saved.backAt ?? null };
  log(`watcher started: bupulse.com points at the ${serving ?? "unknown (treated as PC)"}`);

  const round = async () => {
    const [pcOk, macOk] = await Promise.all([healthy(config.pcHealthUrl), healthy(config.macHealthUrl)]);
    const result = decide(state, { pcOk, macOk, now: Date.now() });
    if (result.switchTo) {
      try {
        await dns.pointAll(result.switchTo);
        const text = result.switchTo === "mac"
          ? `bupulse.com: the office PC has not answered for ${Math.round(TIMING.failAfterMs / 60_000)} minutes, the site now runs from the Mac (scheduled posts wait for the PC). It goes back after ${Math.round(result.state.recoverMs / 60_000)} good minutes.`
          : `bupulse.com: the office PC answered well for ${Math.round(state.recoverMs / 60_000)} minutes, the site is back on the PC.`;
        log(`switched to the ${result.switchTo}`);
        notify(text);
        state = result.state;
      } catch (e) {
        // The DNS change failed: try again next round, from the same state.
        log(`switch to the ${result.switchTo} failed: ${e.message}`);
      }
    } else {
      if (state.serving === "pc" && !pcOk && !state.pcBadSince) log(`PC not answering${macOk ? "" : " (the Mac neither)"}`);
      if (state.serving === "mac" && pcOk && !state.pcGoodSince) log("PC answering again");
      state = result.state;
    }
    writeFileSync(stateFile, JSON.stringify({ ...state, pcOk, macOk, at: new Date().toISOString() }));
  };
  await round();
  setInterval(() => round().catch((e) => log(`round failed: ${e.message}`)), TIMING.checkMs);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
