import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ServerMonitor } from "@/lib/monitor/dashboard";
import { durationWords, kigaliTime } from "@/lib/monitor/uptime-rules";
import { AutoRefresh } from "./auto-refresh";

// The support app's Server page (docs/SUPPORT_DASHBOARD.md, "Server monitoring"): plain words for a non-technical
// owner. Rendered on the server from getServerMonitor (lib/monitor/dashboard.ts) and refreshed every minute.

const AMBER = "text-[#b45309] dark:text-[#ffc65c]";
const AMBER_BG = "bg-[#fff4e0] dark:bg-[#3a2a0a]";

const PAGE_NAMES: Record<string, string> = { "/": "Home page", "/pricing": "Pricing page", "/login": "Sign-in page" };
const TASK_NAMES: Record<string, string> = {
  "BuPulse server": "Website (the BuPulse server)",
  "BuPulse tunnel": "Tunnel (connects the PC to the internet)",
  "BuPulse jobs": "Scheduled jobs (posts, reminders)",
};
const TASK_STATES: Record<string, string> = { Running: "Running", Ready: "Stopped", Disabled: "Switched off", Queued: "Waiting to start", Missing: "Not installed", Unknown: "Unknown" };
const REASONS: Record<string, string> = {
  "failed-check": "The outside check could not reach the site",
  "pc-silent": "The server PC stopped reporting too",
  "long-gap": "No check reached the site for a long time",
  ongoing: "Going on now",
};

function ago(iso: string | null, now: number): string {
  if (!iso) return "never";
  const m = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  return `${durationWords(m)} ago`;
}

const gb = (mb: number) => `${(mb / 1024).toFixed(mb >= 10 * 1024 ? 0 : 1)} GB`;
const mbText = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.round(b / 1e6)} MB`);
// Rounded down, so 99.96% never shows as 100%.
const pct = (v: number | null) => (v === null ? "–" : v >= 100 ? "100%" : `${(Math.floor(v * 10) / 10).toFixed(1)}%`);

/** The end of an outage: only the time when it is the same day as the start. */
function endTime(startIso: string, endIso: string): string {
  const [startDay] = kigaliTime(new Date(startIso)).split(", ");
  const [endDay, time] = kigaliTime(new Date(endIso)).split(", ");
  return startDay === endDay ? time : `${endDay}, ${time}`;
}

function speed(ms: number | null): { label: string; tone: string } {
  if (ms === null) return { label: "–", tone: "text-muted" };
  if (ms < 1000) return { label: "Fast", tone: "text-success" };
  if (ms < 3000) return { label: "OK", tone: AMBER };
  return { label: "Slow", tone: "text-danger" };
}

function Card({ id, title, note, children, dashed }: { id: string; title: string; note?: ReactNode; children: ReactNode; dashed?: boolean }) {
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-3 rounded-[20px] border bg-surface p-4 sm:p-5", dashed ? "border-dashed border-[#7b5cff]/40" : "border-line")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="text-[17px] font-bold">{title}</h2>
        {note && <span className="text-[13px] text-muted">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** A labelled bar: how full something is. */
function Meter({ label, value, detail, warnAt = 0.8, dangerAt = 0.9 }: { label: string; value: number | null; detail: string; warnAt?: number; dangerAt?: number }) {
  const v = value === null ? null : Math.min(1, Math.max(0, value));
  const tone = v === null ? "bg-line" : v >= dangerAt ? "bg-danger" : v >= warnAt ? "bg-[#f59e0b]" : "bg-success";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13.5px]">
        <span className="font-semibold">{label}</span>
        <span className="tabular-nums text-muted">{detail}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line/60" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v === null ? undefined : Math.round(v * 100)}>
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${v === null ? 0 : Math.max(2, v * 100)}%` }} />
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-line/60 py-2 text-[13.5px] last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 text-right font-medium">{children}</span>
    </div>
  );
}

function Banner({ m, now }: { m: ServerMonitor; now: number }) {
  const down = m.issues.some((i) => i.level === "down");
  if (m.issues.length === 0) {
    const parts = [
      m.site.kind === "up" ? `bupulse.com answered the outside check ${ago(m.site.lastCheckAt, now)}.` : m.site.kind === "never" ? "The outside check is not set up yet (see below)." : "",
      m.pc.state === "ok" ? `The server PC reported ${ago(m.pc.lastAt, now)}.` : m.pc.state === "never" ? "The server PC has not reported yet (see below)." : "",
    ].filter(Boolean);
    return (
      <div role="status" className="flex items-start gap-3 rounded-[20px] border border-line bg-success-bg px-4 py-3.5">
        <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
        <div className="flex flex-col gap-0.5">
          <strong className="text-[15px]">Everything is working</strong>
          <span className="text-sm text-muted">{parts.join(" ")}</span>
        </div>
      </div>
    );
  }
  const Icon = down ? XCircle : AlertTriangle;
  return (
    <div role="alert" className={cn("flex items-start gap-3 rounded-[20px] border px-4 py-3.5", down ? "border-danger/35 bg-danger-bg" : cn("border-line", AMBER_BG))}>
      <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", down ? "text-danger" : AMBER)} />
      <div className="flex min-w-0 flex-col gap-1">
        <strong className={cn("text-[15px]", down ? "text-danger" : AMBER)}>{down ? "Something is down" : "Something needs a look"}</strong>
        <ul className="flex flex-col gap-1 text-sm">
          {m.issues.map((i) => <li key={i.text}>{i.text}</li>)}
        </ul>
      </div>
    </div>
  );
}

function Uptime({ m, now }: { m: ServerMonitor; now: number }) {
  const tiles = [
    { label: "Today", value: m.uptime.today },
    { label: "Last 7 days", value: m.uptime.week },
    { label: "Last 30 days", value: m.uptime.month },
  ];
  const sinceRecent = m.uptime.since && now - new Date(m.uptime.since).getTime() < 30 * 86_400_000;
  return (
    <Card id="uptime" title="Uptime" note="Checked from outside every 5 minutes">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="flex flex-col gap-1 rounded-2xl border border-line p-3">
            <span className="text-[12.5px] text-muted">{t.label}</span>
            <span className={cn("text-[22px] font-bold tabular-nums tracking-[-0.02em] sm:text-[26px]", t.value !== null && t.value < 99 ? "text-danger" : t.value !== null && t.value < 99.9 ? AMBER : "")}>{pct(t.value)}</span>
          </div>
        ))}
      </div>
      {m.site.kind === "never" ? (
        <p className="text-[13.5px] text-muted">No outside check has arrived yet, so there is nothing to count.</p>
      ) : sinceRecent ? (
        <p className="text-[13px] text-muted">Counting since {kigaliTime(new Date(m.uptime.since!))} (Kigali time), when the checks started.</p>
      ) : null}
      <h3 className="pt-1 text-[14px] font-semibold">Recent outages</h3>
      {m.outages.length === 0 ? (
        <p className="text-[13.5px] text-muted">No outages in the last 30 days.</p>
      ) : (
        <ul className="flex flex-col">
          {m.outages.map((o) => (
            <li key={o.startedAt} className="flex flex-col gap-0.5 border-b border-line/60 py-2 text-[13.5px] last:border-b-0">
              <span className="flex flex-wrap justify-between gap-x-3">
                <strong className={o.endedAt ? "" : "text-danger"}>
                  {kigaliTime(new Date(o.startedAt))} → {o.endedAt ? endTime(o.startedAt, o.endedAt) : "now"}
                </strong>
                <span className="tabular-nums">{durationWords(o.minutes)}{o.endedAt ? "" : " so far"}</span>
              </span>
              <span className="text-muted">{REASONS[o.reason] ?? o.reason}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12.5px] text-muted">Times are Kigali time, from the last good check to the next good one, so an outage may have been a little shorter.</p>
    </Card>
  );
}

function Pc({ m, now }: { m: ServerMonitor; now: number }) {
  const pc = m.pc;
  if (pc.state === "never") {
    return (
      <Card id="pc" title="The server PC">
        <p className="flex items-start gap-2 text-sm text-muted">
          <CircleDashed aria-hidden className="mt-0.5 size-4 shrink-0" />
          The home PC that runs bupulse.com has not reported yet. It starts reporting once its job loop runs the new version (see &quot;What is left to set up&quot; below).
        </p>
      </Card>
    );
  }
  const mem = pc.memUsedMb !== null && pc.memTotalMb ? pc.memUsedMb / pc.memTotalMb : null;
  const upMinutes = pc.bootAt ? Math.round((now - new Date(pc.bootAt).getTime()) / 60_000) : null;
  return (
    <Card id="pc" title="The server PC" note={<span className={pc.state === "silent" ? "font-semibold text-danger" : ""}>{pc.state === "silent" ? `Not reporting for ${durationWords(pc.minutesSilent ?? 0)}` : `Reported ${ago(pc.lastAt, now)}`}</span>}>
      <div className="flex flex-col gap-3">
        <Meter label="Processor (CPU)" value={pc.cpuPercent === null ? null : pc.cpuPercent / 100} detail={pc.cpuPercent === null ? "–" : `${pc.cpuPercent}% now${pc.cpuHourAvg !== null ? `, ${pc.cpuHourAvg}% average this hour` : ""}`} />
        <Meter label="Memory" value={mem} detail={pc.memUsedMb !== null && pc.memTotalMb ? `${gb(pc.memUsedMb)} used of ${gb(pc.memTotalMb)}` : "–"} warnAt={0.85} dangerAt={0.95} />
        {pc.disks.map((d) => (
          <Meter
            key={d.name}
            label={`Disk ${d.name}${d.roles.length ? ` (${d.roles.map((r) => (r === "system" ? "Windows" : "BuPulse")).join(" and ")})` : ""}`}
            value={d.totalGb && d.freeGb !== null ? 1 - d.freeGb / d.totalGb : null}
            detail={d.totalGb && d.freeGb !== null ? `${d.freeGb} GB free of ${d.totalGb} GB` : "–"}
          />
        ))}
      </div>
      <div className="flex flex-col">
        <Row label="Last restart">{upMinutes === null ? "–" : `${durationWords(upMinutes)} ago (${kigaliTime(new Date(pc.bootAt!))})`}</Row>
        {Object.keys(TASK_NAMES).map((name) => {
          const t = pc.tasks.find((x) => x.name === name);
          const state = t?.state ?? "Unknown";
          return (
            <Row key={name} label={TASK_NAMES[name]}>
              <span className={state === "Running" ? "text-success" : state === "Unknown" ? "text-muted" : "text-danger"}>{TASK_STATES[state] ?? state}</span>
            </Row>
          );
        })}
        {pc.serverListening === false && <Row label="Website on the PC"><span className="text-danger">Not answering on port 3002</span></Row>}
      </div>
      <p className="text-[12.5px] text-muted">
        {[pc.machine, pc.os, pc.nodeVersion && `Node ${pc.nodeVersion}`, pc.cloudflaredVersion].filter(Boolean).join(" · ")}
      </p>
    </Card>
  );
}

function SiteChecks({ m }: { m: ServerMonitor }) {
  const last = m.checks.last;
  const lastByPath = new Map((last?.pages ?? []).map((p) => [p.path, p]));
  const dbPct = m.db.sizeBytes !== null && m.db.limitBytes ? m.db.sizeBytes / m.db.limitBytes : null;
  return (
    <Card id="checks" title="Site checks" note={last ? `Last outside check ${kigaliTime(new Date(last.checkedAt))}` : undefined}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-[13.5px]">
          <caption className="sr-only">How fast the pages open from outside</caption>
          <thead>
            <tr className="text-left text-xs tracking-[0.03em] text-muted">
              {["PAGE", "LAST CHECK", "AVERAGE, 24 H"].map((h) => <th key={h} scope="col" className="border-b border-line py-2.5 pr-3 font-semibold">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {m.checks.avg24h.map((a) => {
              const p = lastByPath.get(a.path);
              const failed = p && (p.status === null || p.status >= 500);
              const s = speed(p?.ms ?? null);
              return (
                <tr key={a.path}>
                  <td className="border-b border-line/60 py-2.5 pr-3 font-semibold">{PAGE_NAMES[a.path] ?? a.path}</td>
                  <td className="border-b border-line/60 py-2.5 pr-3 tabular-nums">
                    {!p ? "–" : failed ? <span className="text-danger">Failed{p.status ? ` (error ${p.status})` : ""}</span> : <><span className={s.tone}>{s.label}</span> · {((p.ms ?? 0) / 1000).toFixed(1)} s</>}
                  </td>
                  <td className="border-b border-line/60 py-2.5 pr-3 tabular-nums">
                    {a.ms === null ? "–" : `${(a.ms / 1000).toFixed(1)} s`}
                    {a.failures ? <span className="text-danger"> · failed {a.failures}×</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col">
        <Row label="Database answer time">
          {m.db.nowMs === null ? <span className="text-danger">Did not answer</span> : `${m.db.nowMs} ms now`}
          {last?.databaseMs != null ? ` · ${last.databaseMs} ms at the last outside check` : ""}
        </Row>
        {dbPct !== null && <Row label="Database size">{`${mbText(m.db.sizeBytes!)} of ${mbText(m.db.limitBytes!)} (${Math.round(dbPct * 100)}%)`}</Row>}
        <Row label="Errors">
          {m.errors ? (
            <span className={m.errors.lastHour >= 10 ? "text-danger" : ""}>{`${m.errors.lastHour} in the last hour, ${m.errors.last24h} in 24 hours`}</span>
          ) : (
            "–"
          )}
        </Row>
        {m.errors && m.errors.top.length > 0 && (
          <Row label="Most errors from">{m.errors.top.map((t) => `${t.source} (${t.count})`).join(", ")}</Row>
        )}
        <Row label="Scheduled jobs">
          {m.jobs ? <span className={m.jobs.problems.length ? AMBER : "text-success"}>{m.jobs.problems.length ? `${m.jobs.ok} of ${m.jobs.total} fine` : `All ${m.jobs.total} fine`}</span> : "–"}
        </Row>
      </div>
      {m.jobs && m.jobs.problems.length > 0 && (
        <ul className="flex flex-col gap-1 text-[13.5px]">
          {m.jobs.problems.map((p) => (
            <li key={p.label}><strong>{p.label}</strong> {p.text}.</li>
          ))}
        </ul>
      )}
      <p className="text-[12.5px] text-muted">Full details for the owner: Admin → Health and Admin → Errors.</p>
    </Card>
  );
}

function Setup({ m }: { m: ServerMonitor }) {
  if (m.site.kind !== "never" && m.pc.state !== "never") return null;
  return (
    <Card id="setup" title="What is left to set up" dashed>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13.5px]">
        {m.site.kind === "never" && (
          <li>
            Outside check: make a long random password, save it as <strong>UPTIME_SECRET</strong> in Admin → Services (custom key) and as a GitHub
            repository secret with the same name. Add TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID and RESEND_API_KEY there too for the &quot;site is down&quot; alerts.
          </li>
        )}
        {m.pc.state === "never" && (
          <li>Server PC: after the next update on the PC, restart the &quot;BuPulse jobs&quot; task (update.ps1 does it), and the PC starts reporting every minute.</li>
        )}
      </ol>
    </Card>
  );
}

export function ServerView({ m }: { m: ServerMonitor }) {
  const now = new Date(m.generatedAt).getTime();
  return (
    <main className="flex flex-1 flex-col gap-5 p-4 sm:p-6">
      <AutoRefresh />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.02em]">Server</h1>
          <p className="text-sm text-muted">Is bupulse.com up, and how is the home PC that runs it? Updates every minute.</p>
        </div>
        <span className="text-[13px] text-muted">Checked {kigaliTime(new Date(m.generatedAt))} (Kigali time)</span>
      </header>
      <Banner m={m} now={now} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Uptime m={m} now={now} />
        <Pc m={m} now={now} />
        <SiteChecks m={m} />
        <div className="flex min-w-0 flex-col gap-4">
          <Setup m={m} />
          <Card id="backup" title="Backup servers" note="Not set up yet" dashed>
            <p className="flex items-start gap-2 text-sm text-muted">
              <CircleDashed aria-hidden className="mt-0.5 size-4 shrink-0 text-new" />
              Today one home PC runs bupulse.com. When a second computer or a cloud server is ready to take over if this PC stops, it will be listed here with
              its own status, so you can see at a glance which one is serving the site.
            </p>
          </Card>
        </div>
      </div>
    </main>
  );
}
