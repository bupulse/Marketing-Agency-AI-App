// The server PC's own uptime check, every 5 minutes (scripts/self-host/windows/cron-loop.ps1 runs it on :02, :07, …,
// between GitHub's runs). GitHub's 5-minute schedule is often 5-20 minutes late, so this gives the uptime record a point
// every 5 minutes while the PC is on; GitHub stays the independent outside check for when the PC itself is down.
//
// It times the site through its PUBLIC address (https://bupulse.com: the internet, Cloudflare and the tunnel, the same
// checks as uptime-check.mjs, a second try a minute later when down), then posts the result to the LOCAL server
// (http://127.0.0.1:3002/api/monitor/uptime, Bearer: the PC's CRON_SECRET, as the heartbeat does), so a failed check is
// recorded even while the tunnel is down. It sends no alerts (GitHub sends "down", the server sends "back up"). A small
// state file remembers whether the last check found the site down, which is the "afterFailure" GitHub sends too.
//
//   node scripts/monitor/pc-self-check.mjs <cron-secret file> <state file>
//
// Prints one line for the log, never the secret. Exit code 0 even when the site is down.

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { checkWithRetry, report } from "./uptime-check.mjs";

/** The state file's "last check found the site down", false when there is no state yet or it cannot be read. */
export function lastWasDown(text) {
  try {
    return JSON.parse(text)?.down === true;
  } catch {
    return false;
  }
}

/**
 * @param {{ site: string, local: string, secret: string, previousDown: boolean }} target
 * @param {{ fetchImpl?: typeof fetch, wait?: (ms: number) => Promise<void> }} [deps]
 */
export async function selfCheck({ site, local, secret, previousDown }, { fetchImpl = fetch, wait } = {}) {
  const result = await checkWithRetry(site, { fetchImpl, ...(wait ? { wait } : {}) });
  const recorded = await report(local, secret, { ...result, afterFailure: previousDown }, fetchImpl);
  const times = result.pages.map((p) => `${p.path} ${p.status ?? "no answer"} ${p.ms ?? "-"} ms`).join(", ");
  const line = `${result.ok ? "UP" : "DOWN"}: /api/status ${result.statusCode ?? "no answer"} ${result.statusMs ?? "-"} ms (database ${result.databaseMs ?? "-"} ms); ${times}${result.retried ? "; checked twice" : ""}. Check ${recorded}.`;
  return { result, line, down: !result.ok };
}

export async function main(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
  const [secretFile, stateFile] = argv;
  if (!secretFile || !stateFile) {
    console.log("Usage: node scripts/monitor/pc-self-check.mjs <cron-secret file> <state file>");
    return 1;
  }
  const site = (env.SITE_URL || "https://bupulse.com").replace(/\/$/, "");
  const local = (env.LOCAL_URL || "http://127.0.0.1:3002").replace(/\/$/, "");
  const secret = (await readFile(secretFile, "utf8").catch(() => "")).replace(/^﻿/, "").trim();
  const previousDown = lastWasDown(await readFile(stateFile, "utf8").catch(() => ""));
  const { line, down } = await selfCheck({ site, local, secret, previousDown }, { fetchImpl });
  await writeFile(stateFile, JSON.stringify({ down, at: new Date().toISOString() })).catch(() => undefined);
  console.log(line);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.log(`The self-check itself failed: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    },
  );
}
