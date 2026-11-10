"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useState } from "react";
import { Activity, Database, Globe, Loader2, Play, RefreshCw, Timer } from "lucide-react";
import { runCheckNow, type ManualCheckState } from "@/app/support/(app)/server/actions";
import { cn } from "@/lib/cn";
import { CHECK_EVERY_MS, clock, nextCheck, type ManualCheckResult } from "@/lib/monitor/manual-check";
import { Bar, LevelPill } from "./gauges";
import { seconds, share, speedLevel, type Level } from "./server-math";

// "Checked every 5 minutes · last check 2 min ago · next in 2:41", and the "Run a check now" button: checking… with a
// moving list, then the result popping in (the health check, each page, the database), then the page data reloads.

const PAGE_NAMES: Record<string, string> = { "/": "Home page", "/pricing": "Pricing page", "/login": "Sign-in page" };
const STEPS = ["Health check", "Home page", "Pricing page", "Sign-in page", "Database"];

/** The made-up answer the dev-only preview shows instead of running the server action. */
export function previewCheckResult(nowIso: string): ManualCheckResult {
  return {
    checkedAt: nowIso,
    site: "bupulse.com",
    ok: true,
    statusCode: 200,
    statusMs: 182,
    databaseMs: 31,
    version: "1.4.2",
    pages: [
      { path: "/", status: 200, ms: 612 },
      { path: "/pricing", status: 200, ms: 1340 },
      { path: "/login", status: 200, ms: 455 },
    ],
    outside: "started",
  };
}

function Countdown({ lastCheckAt, generatedAt }: { lastCheckAt: string | null; generatedAt: string }) {
  const [now, setNow] = useState(() => new Date(generatedAt).getTime());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const n = nextCheck(lastCheckAt, now);
  const progress = lastCheckAt ? 1 - n.inSeconds / (CHECK_EVERY_MS / 1000) : 0;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="relative size-11 shrink-0">
        <svg viewBox="0 0 44 44" aria-hidden className="size-full -rotate-90">
          <circle cx="22" cy="22" r="18" fill="none" strokeWidth="4" className="stroke-pulse-blue/15" />
          <circle cx="22" cy="22" r="18" fill="none" strokeWidth="4" strokeLinecap="round" pathLength={100} strokeDasharray={`${Math.max(0.5, progress * 100)} 100`} className="stroke-pulse-blue transition-[stroke-dasharray] duration-1000 ease-linear motion-reduce:transition-none" />
        </svg>
        <Timer aria-hidden className="absolute inset-0 m-auto size-4 text-pulse-blue" />
      </div>
      <p className="min-w-0 text-[13.5px] leading-snug">
        <strong className="font-semibold">Checked every 5 minutes</strong>
        <span className="block text-muted">
          {n.agoMinutes === null ? (
            "No check has arrived yet."
          ) : (
            <>
              Last check {n.agoMinutes < 1 ? "just now" : `${n.agoMinutes} min ago`} ·{" "}
              {n.lateMinutes ? (
                <span className="text-[#b45309] dark:text-[#ffc65c]">next one is {n.lateMinutes} min late (GitHub sometimes runs late; the PC&apos;s own check fills in)</span>
              ) : n.inSeconds > 0 ? (
                <>
                  next in <span className="tabular-nums font-semibold text-text">{clock(n.inSeconds)}</span>
                </>
              ) : (
                "next one any moment"
              )}
            </>
          )}
        </span>
      </p>
    </div>
  );
}

function Checking({ site }: { site: string }) {
  return (
    <div role="status" className="srv-pop flex flex-col gap-2.5 rounded-2xl border border-line bg-soft p-3.5">
      <p className="flex items-center gap-2 text-[14px] font-semibold">
        <Loader2 aria-hidden className="srv-spin size-4 text-pulse-blue" /> Checking {site}…
      </p>
      <ul className="flex flex-col gap-2">
        {STEPS.map((s, i) => (
          <li key={s} className="srv-rise flex items-center gap-3 text-[13px]" style={{ animationDelay: `${i * 0.12}s` }}>
            <span className="w-[110px] shrink-0 text-muted sm:w-[150px]">{s}</span>
            <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-pulse-blue/10">
              <span className="srv-sweep absolute inset-y-0 left-0 w-2/5 rounded-full bg-[linear-gradient(90deg,transparent,rgba(47,107,255,0.55),transparent)]" style={{ animationDelay: `${i * 0.15}s` }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Result({ r }: { r: ManualCheckResult }) {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kigali", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(r.checkedAt));
  const rows: { label: string; ms: number | null; failed: boolean; status: number | null }[] = [
    { label: "Health check (/api/status)", ms: r.statusMs, failed: !r.ok, status: r.statusCode },
    ...r.pages.map((p) => ({ label: PAGE_NAMES[p.path] ?? p.path, ms: p.ms, failed: p.status === null || p.status >= 500, status: p.status })),
  ];
  const dbLevel: Level = r.databaseMs === null ? "none" : r.databaseMs < 100 ? "good" : r.databaseMs < 500 ? "warn" : "bad";
  return (
    <div role="status" className="srv-pop flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-[0_14px_36px_-26px_rgba(17,24,39,0.5)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[15px] font-bold">
          <span aria-hidden className={cn("inline-flex size-8 items-center justify-center rounded-xl text-white", r.ok ? "bg-[linear-gradient(140deg,#0f9f6e,#2f6bff)]" : "bg-[linear-gradient(140deg,#c81e3a,#e0574f)]")}>
            <Activity className="size-4" />
          </span>
          {r.ok ? `${r.site} is up` : `${r.site} did not answer properly`}
        </p>
        <span className="text-[12.5px] text-muted">Checked at {time} (Kigali time)</span>
      </div>
      <ul className="flex flex-col gap-2.5">
        {rows.map((row, i) => {
          const level: Level = row.failed ? "bad" : speedLevel(row.ms);
          return (
            <li key={row.label} className="srv-rise flex flex-col gap-1" style={{ animationDelay: `${i * 0.08}s` }}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px]">
                <span className="font-semibold">{row.label}</span>
                <span className="flex items-center gap-2 tabular-nums">
                  {row.failed ? `Failed${row.status ? ` (error ${row.status})` : " (no answer)"}` : seconds(row.ms)}
                  <LevelPill level={level}>{row.failed ? "Failed" : level === "good" ? "Fast" : level === "warn" ? "OK" : "Slow"}</LevelPill>
                </span>
              </div>
              <Bar value={row.failed ? 1 : share(row.ms, 3000)} level={level} label={`${row.label}: ${row.failed ? "failed" : seconds(row.ms)}`} delay={i * 0.08} />
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-2.5 text-[13px]">
        <span className="flex items-center gap-1.5">
          <Database aria-hidden className="size-4 text-muted" /> Database answered in <strong className="tabular-nums">{r.databaseMs === null ? "–" : `${r.databaseMs} ms`}</strong>
          <LevelPill level={dbLevel} />
        </span>
        <span className="flex items-center gap-1.5 text-muted">
          <Globe aria-hidden className="size-4 shrink-0" />
          {r.outside === "started" ? "GitHub's outside check started too; it shows up here in about a minute." : r.outside === "failed" ? "GitHub's outside check could not be started." : "GitHub's outside check is not connected here (no GITHUB_REPO / GITHUB_TOKEN)."}
        </span>
      </div>
      <p className="text-[12px] text-muted">This check is shown here only; the uptime record keeps the scheduled checks every 5 minutes.</p>
    </div>
  );
}

function PreviewButton({ generatedAt }: { generatedAt: string }) {
  const [phase, setPhase] = useState<"idle" | "checking" | "done">("idle");
  return (
    <CheckPanel
      pending={phase === "checking"}
      result={phase === "done" ? previewCheckResult(generatedAt) : null}
      error={null}
      onRun={() => {
        setPhase("checking");
        setTimeout(() => setPhase("done"), 1800);
      }}
    />
  );
}

function LiveButton() {
  const router = useRouter();
  const [state, action, pending] = useActionState<ManualCheckState, FormData>(runCheckNow, {});
  const checkedAt = state.result?.checkedAt;
  useEffect(() => {
    if (checkedAt) router.refresh();
  }, [checkedAt, router]);
  return <CheckPanel pending={pending} result={state.result ?? null} error={state.error ?? null} onRun={() => startTransition(() => action(new FormData()))} />;
}

function CheckPanel({ pending, result, error, onRun }: { pending: boolean; result: ManualCheckResult | null; error: string | null; onRun: () => void }) {
  return (
    <>
      <button
        type="button"
        onClick={onRun}
        disabled={pending}
        className="inline-flex min-h-11 w-full shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand-gradient px-4 sm:w-auto text-sm font-semibold text-white shadow-[0_10px_24px_-12px_rgba(47,107,255,0.9)] transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30 disabled:cursor-wait disabled:opacity-80 motion-reduce:transform-none"
      >
        {pending ? <Loader2 aria-hidden className="srv-spin size-4" /> : result ? <RefreshCw aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
        {pending ? "Checking…" : result ? "Check again" : "Run a check now"}
      </button>
      {(pending || result || error) && (
        <div className="flex basis-full flex-col gap-2">
          {error && !pending && <p role="alert" className="srv-pop rounded-xl bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
          {pending ? <Checking site={result?.site ?? "the site"} /> : result ? <Result r={result} /> : null}
        </div>
      )}
    </>
  );
}

/** The 5-minute schedule line with its countdown, and the button that runs a check now. */
export function RunCheck({ lastCheckAt, generatedAt, preview = false }: { lastCheckAt: string | null; generatedAt: string; preview?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Countdown lastCheckAt={lastCheckAt} generatedAt={generatedAt} />
      {preview ? <PreviewButton generatedAt={generatedAt} /> : <LiveButton />}
    </div>
  );
}
