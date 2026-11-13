// The server PC's minute-by-minute down watch (docs/SELF_HOST.md, "Down alert"): the rules that turn the supervisor's
// reports (scripts/self-host/windows/supervisor.mjs checks https://bupulse.com from outside every minute and posts the
// result to the local server) into at most ONE "down" message and ONE "back up" message per outage. Pure, no imports
// but the words: tests/monitor/watch.test.ts.
//
// - Down: the outside check failed for DOWN_AFTER_MS (2 minutes; with a check a minute, the third failure in a row).
//   The supervisor also says since when the local server could not take its reports (it crashed or hung and is being
//   restarted), which counts as down from that moment.
// - Back up: the first good check after a "down" message, or after an outage of 2 minutes or more that could not be
//   told while it lasted (the PC's internet was down, so nothing could be sent): one "was down N minutes" message.
// - Planned: while update.ps1 has the website stopped (maintenance) nothing starts an outage.
// - A message that could not be delivered (a channel failed) is tried again on the next report; a channel that is not
//   set up does not count as a failure (Admin -> Health lists it), so nothing is retried every minute for ever.

import { durationWords, kigaliTime } from "./uptime-rules";

export const DOWN_AFTER_MS = 2 * 60_000;
/** A gap this long between reports means the watch itself stopped (the PC was off): it starts again from "now". */
export const WATCH_STALE_MS = 10 * 60_000;
export const WATCH_MAX_BYTES = 2_048;

export type WatchReport = {
  publicOk: boolean;
  publicStatus: number | null;
  localOk: boolean;
  tunnelReady: boolean;
  /** update.ps1 stopped the website on purpose. */
  maintenance: boolean;
  /** Since when the local server could not take the supervisor's reports (it was down), when it was. */
  localDownSince: Date | null;
};

export type WatchState = {
  /** The first failed check of the outage going on, or null. */
  failingSince: string | null;
  /** When the "down" message for that outage went out. */
  downAlertedAt: string | null;
  lastReportAt: string | null;
  /** Reports have come in without a long gap since then: the watch saw everything after it. */
  aliveSince: string | null;
  /** The last outage the watch closed with a "back up" message. */
  lastOutage: { startedAt: string; endedAt: string; minutes: number } | null;
};

export const EMPTY_WATCH: WatchState = { failingSince: null, downAlertedAt: null, lastReportAt: null, aliveSince: null, lastOutage: null };

export type DownCause = "server" | "tunnel" | "database" | "outside";
export type WatchOutage = { startedAt: Date; endedAt: Date; minutes: number };
export type WatchSend = { kind: "down"; since: Date; minutes: number; cause: DownCause } | { kind: "up"; outage: WatchOutage; downWasSent: boolean };

const iso = (d: Date) => d.toISOString();
const date = (s: string | null | undefined) => (s ? new Date(s) : null);
const minutesBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));

export function readWatchState(value: unknown): WatchState {
  const v = (value && typeof value === "object" ? value : {}) as Partial<WatchState>;
  const s = (x: unknown) => (typeof x === "string" && !Number.isNaN(Date.parse(x)) ? x : null);
  const o = v.lastOutage as WatchState["lastOutage"] | undefined;
  return {
    failingSince: s(v.failingSince),
    downAlertedAt: s(v.downAlertedAt),
    lastReportAt: s(v.lastReportAt),
    aliveSince: s(v.aliveSince),
    lastOutage: o && s(o.startedAt) && s(o.endedAt) ? { startedAt: o.startedAt, endedAt: o.endedAt, minutes: Number(o.minutes) || 0 } : null,
  };
}

/** What most likely broke, from what the PC itself could see. */
export function downCause(r: Pick<WatchReport, "localOk" | "tunnelReady" | "publicStatus">): DownCause {
  if (!r.localOk) return "server";
  if (!r.tunnelReady) return "tunnel";
  if (r.publicStatus === 503) return "database";
  return "outside";
}

/**
 * The next state and the message to send (if any). The caller sends it and then records the delivery with
 * `afterSend`; until then the state carries no "down sent", so an undelivered message is tried again next time.
 */
export function nextWatch(prev: WatchState, r: WatchReport, now: Date): { state: WatchState; send: WatchSend | null } {
  const last = date(prev.lastReportAt);
  const continuous = last !== null && now.getTime() - last.getTime() <= WATCH_STALE_MS;
  const state: WatchState = { ...prev, lastReportAt: iso(now), aliveSince: continuous && prev.aliveSince ? prev.aliveSince : iso(now) };
  let failing = date(prev.failingSince);
  // The server could not take reports for a while (it was being restarted): down since then, unless that was planned.
  if (r.localDownSince && !r.maintenance && r.localDownSince.getTime() < now.getTime()) {
    if (!failing || r.localDownSince < failing) failing = r.localDownSince;
  }

  if (!r.publicOk) {
    if (r.maintenance && !prev.downAlertedAt) {
      // An update: not an outage. (One already told about stays open until the site answers.)
      return { state: { ...state, failingSince: null }, send: null };
    }
    failing ??= now;
    state.failingSince = iso(failing);
    const down = now.getTime() - failing.getTime();
    if (!prev.downAlertedAt && down >= DOWN_AFTER_MS) {
      return { state, send: { kind: "down", since: failing, minutes: minutesBetween(failing, now), cause: downCause(r) } };
    }
    return { state, send: null };
  }

  // The site answers.
  const cleared: WatchState = { ...state, failingSince: null, downAlertedAt: null };
  if (!failing) return { state: cleared, send: null };
  const outage: WatchOutage = { startedAt: failing, endedAt: now, minutes: minutesBetween(failing, now) };
  const downWasSent = Boolean(prev.downAlertedAt);
  // Without a "down" message: only when it was down longer than the 2 minutes a "down" message waits for (two failed
  // checks and then a good one is the blip a third failure would have turned into an outage).
  if (downWasSent || now.getTime() - failing.getTime() > DOWN_AFTER_MS) return { state: cleared, send: { kind: "up", outage, downWasSent } };
  return { state: cleared, send: null };
}

/** Records a message that went out (or that no channel could take because none is set up). */
export function afterSend(state: WatchState, send: WatchSend, now: Date): WatchState {
  if (send.kind === "down") return { ...state, downAlertedAt: iso(now) };
  return { ...state, lastOutage: { startedAt: iso(send.outage.startedAt), endedAt: iso(send.outage.endedAt), minutes: send.outage.minutes } };
}

/** Delivered: at least one channel sent it, or none failed (channels that are not set up are skipped, not retried). */
export function delivered(outcomes: Record<string, string>): boolean {
  const values = Object.values(outcomes);
  return values.includes("sent") || !values.includes("failed");
}

/**
 * Did the watch see this outage (found by the uptime checks, lib/monitor/uptime.ts) from its start, and is it still
 * reporting? Then the watch already said what was needed (a down and a back-up message, or nothing for a blip under 2
 * minutes) and the uptime record must not send a second "back up". When the PC was off, the watch saw nothing: the
 * uptime record's message goes out.
 */
export function watchCovers(state: WatchState, outage: { startedAt: Date; endedAt: Date }, now: Date): boolean {
  const last = date(state.lastReportAt);
  const alive = date(state.aliveSince);
  if (!last || !alive) return false;
  if (now.getTime() - last.getTime() > 5 * 60_000) return false;
  return alive.getTime() <= outage.startedAt.getTime();
}

// ---- words ------------------------------------------------------------------------------------------------------

const CAUSE: Record<DownCause, string> = {
  server: "The website on the server PC is not answering. The supervisor restarts it by itself.",
  tunnel: "The tunnel from the server PC to Cloudflare is not connected (the PC's internet, or Cloudflare). The supervisor restarts it by itself.",
  database: "The website answers but cannot reach its database (Supabase).",
  outside: "bupulse.com does not answer from outside, although the server PC and its tunnel look fine (Cloudflare or DNS).",
};

export function watchText(send: WatchSend): { subject: string; heading: string; line: string } {
  if (send.kind === "down") {
    return {
      subject: "bupulse.com is down",
      heading: "bupulse.com is down",
      line: `bupulse.com has been down since ${kigaliTime(send.since)} (Kigali time), about ${durationWords(Math.max(2, send.minutes))}. ${CAUSE[send.cause]} You get one more message when it is back.`,
    };
  }
  const { outage } = send;
  return {
    subject: `bupulse.com is back up (down about ${durationWords(outage.minutes)})`,
    heading: "bupulse.com is back up",
    line: `bupulse.com is back up. It was down for about ${durationWords(outage.minutes)}, from ${kigaliTime(outage.startedAt)} to ${kigaliTime(outage.endedAt)} (Kigali time).`,
  };
}

// ---- the report the supervisor posts ------------------------------------------------------------------------------

export function parseWatchReport(raw: unknown, now = new Date()): { ok: true; value: WatchReport } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Send a JSON object." };
  const o = raw as Record<string, unknown>;
  if (typeof o.publicOk !== "boolean") return { ok: false, error: "publicOk must be true or false." };
  const status = typeof o.publicStatus === "number" && Number.isInteger(o.publicStatus) && o.publicStatus >= 100 && o.publicStatus <= 599 ? o.publicStatus : null;
  let since: Date | null = null;
  if (typeof o.localDownSince === "string") {
    const d = new Date(o.localDownSince);
    // Within the last day and not in the future (a wrong clock must not invent an outage).
    if (!Number.isNaN(d.getTime()) && d.getTime() <= now.getTime() && now.getTime() - d.getTime() <= 86_400_000) since = d;
  }
  return { ok: true, value: { publicOk: o.publicOk, publicStatus: status, localOk: o.localOk !== false, tunnelReady: o.tunnelReady === true, maintenance: o.maintenance === true, localDownSince: since } };
}
