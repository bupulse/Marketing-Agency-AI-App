"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DISPLAY_CURRENCIES, formatMoney, isDisplayCurrency, type DisplayCurrency, type MoneyDisplay } from "@/lib/money/display";
import { POLL_MS, compactMoney, goalProgress, mixedMinor, nextSound, screenMoney, screenTotal, shares, trialLeftShare, type Celebration, type ScreenData } from "@/lib/screen/shared";

// The sales room TV. Dark whatever the theme (the "dark" class switches the tokens for this subtree), type sized for a
// room, 16:9 first. One big "Start screen" button comes first: browsers only let a page play sound after a click, so
// that click unlocks the audio element used for every celebration afterwards.

const SOUND_KEY = "bp-screen-last-sound";
/** The currency picked on this TV (RWF, USD or EUR); none means Admin -> Settings "Default currency". */
const CURRENCY_KEY = "bp-screen-currency";
const CELEBRATION_MS = 7_000;
/** An empty WAV: played inside the start click so the browser allows sound later. */
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

type Status = "idle" | "live" | "offline" | "revoked";

export function SalesScreen({ token, name }: { token: string; name: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [data, setData] = useState<ScreenData | null>(null);
  const [current, setCurrent] = useState<Celebration | null>(null);
  const cursor = useRef<string>("");
  const queue = useRef<Celebration[]>([]);
  const sounds = useRef<ScreenData["sounds"]>([]);
  const audio = useRef<HTMLAudioElement | null>(null);
  const lastSound = useRef<string | null>(null);
  const [picked, setPicked] = useState<DisplayCurrency | null>(null);
  const money: MoneyDisplay | null = data ? (picked ? { ...data.money, currency: picked } : data.money) : null;

  function pickCurrency(c: DisplayCurrency) {
    setPicked(c);
    try {
      localStorage.setItem(CURRENCY_KEY, c);
    } catch {
      /* private window: back to the default on reload */
    }
  }

  const poll = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/screen/${encodeURIComponent(token)}/data${cursor.current ? `?after=${encodeURIComponent(cursor.current)}` : ""}`, { cache: "no-store" });
      if (res.status === 404) {
        setStatus("revoked");
        return false;
      }
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as ScreenData;
      cursor.current = next.cursor;
      sounds.current = next.sounds;
      if (next.celebrations.length) queue.current.push(...next.celebrations);
      setData(next);
      setStatus("live");
    } catch {
      setStatus((s) => (s === "revoked" ? s : "offline"));
    }
    return true;
  }, [token]);

  // Polling: every 10 s while the screen runs; a revoked link stops it.
  const running = status !== "idle" && status !== "revoked";
  useEffect(() => {
    if (!running) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (stop) return;
      const go = await poll();
      if (go && !stop) timer = setTimeout(loop, POLL_MS);
    };
    timer = setTimeout(loop, POLL_MS);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [running, poll]);

  // One celebration at a time, each with the next sound in turn.
  useEffect(() => {
    if (current || status === "idle") return;
    const tick = setInterval(() => {
      const next = queue.current.shift();
      if (!next) return;
      setCurrent(next);
      const sound = nextSound(sounds.current, lastSound.current);
      if (sound && audio.current) {
        lastSound.current = sound.id;
        try {
          localStorage.setItem(SOUND_KEY, sound.id);
        } catch {
          /* private window: rotation restarts on reload */
        }
        audio.current.src = sound.url;
        audio.current.currentTime = 0;
        void audio.current.play().catch(() => undefined);
      }
    }, 300);
    return () => clearInterval(tick);
  }, [current, status]);

  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setCurrent(null), CELEBRATION_MS);
    return () => clearTimeout(t);
  }, [current]);

  async function start() {
    try {
      lastSound.current = localStorage.getItem(SOUND_KEY);
      const saved = localStorage.getItem(CURRENCY_KEY);
      if (isDisplayCurrency(saved)) setPicked(saved);
    } catch {
      /* no storage */
    }
    // Unlock audio inside the click: the element plays a silent clip now and is reused for every celebration.
    const el = new Audio(SILENT_WAV);
    void el.play().catch(() => undefined);
    audio.current = el;
    setStatus("live");
    document.documentElement.requestFullscreen?.().catch(() => undefined);
    // Keep the TV awake where the browser allows it.
    (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<unknown> } }).wakeLock?.request("screen").catch(() => undefined);
    await poll();
  }

  return (
    <div className="dark fixed inset-0 overflow-y-auto bg-bg text-text [color-scheme:dark]">
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(47,107,255,0.22),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(123,92,255,0.2),transparent_55%)]" />
      {status === "idle" ? (
        <main className="relative flex min-h-dvh flex-col items-center justify-center gap-8 p-8 text-center">
          <h1 className="text-[clamp(2rem,4vw,4rem)] font-semibold tracking-tight">{name}</h1>
          <button
            type="button"
            onClick={() => void start()}
            className="min-h-24 rounded-panel bg-brand-gradient px-16 text-[clamp(1.75rem,3.5vw,3.5rem)] font-semibold text-white shadow-glow transition-transform hover:scale-[1.02] focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            Start screen
          </button>
          <p className="max-w-2xl text-[clamp(1rem,1.6vw,1.5rem)] text-muted">Starts the live numbers and turns on the sound for new payments.</p>
        </main>
      ) : status === "revoked" ? (
        <main className="relative flex min-h-dvh items-center justify-center p-8 text-center">
          <p role="alert" className="text-[clamp(1.5rem,3vw,3rem)] font-semibold">This screen link is no longer valid. Ask for a new one.</p>
        </main>
      ) : (
        <Board name={name} data={data} money={money} onPick={pickCurrency} offline={status === "offline"} />
      )}
      {current && money && <CelebrationOverlay key={current.id} celebration={current} money={money} />}
    </div>
  );
}

const fmtDays = (d: number) => (d === 0 ? "Ends today" : d === 1 ? "1 day left" : `${d} days left`);

/**
 * A list that, when its box has a fixed height (the one-screen TV layout), shows only the rows that fit whole and
 * says how many more there are: no row is ever cut in half. Elsewhere every row shows and the page scrolls.
 */
function FitList({ as: Tag = "ul", className, children, count }: { as?: "ul" | "ol"; className: string; children: React.ReactNode; count: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const list = el.firstElementChild as HTMLElement | null;
      if (!list) return;
      const rows = [...list.children] as HTMLElement[];
      rows.forEach((r) => (r.style.display = ""));
      const limit = el.getBoundingClientRect().bottom;
      // Only a box shorter than its content (the TV layout) hides rows.
      if (el.scrollHeight <= el.clientHeight + 1) return setHidden(0);
      let n = 0;
      // The first row that does not fit whole (leaving room for the "and N more" line) and every row after it.
      const first = rows.findIndex((r) => r.getBoundingClientRect().bottom > limit - 28);
      if (first >= 0) {
        for (const r of rows.slice(first)) r.style.display = "none";
        n = rows.length - first;
      }
      setHidden(n);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count]);
  return (
    <div ref={box} className="flex h-full min-h-0 flex-col overflow-hidden">
      <Tag className={className}>{children}</Tag>
      {hidden > 0 && <p className={`mt-auto pt-1 ${T.small} text-muted`}>and {hidden} more</p>}
    </div>
  );
}

// Type scales with the screen: phone sizes at the low end, readable across a room on a 1080p or 4K TV.
// The vh term keeps a wide but short screen (a 16:9 TV) from overflowing; a 4K TV gets twice the 1080p size.
const T = {
  small: "text-[clamp(0.8rem,min(0.75vw+0.4rem,1.6vh),3rem)]",
  body: "text-[clamp(0.95rem,min(0.95vw+0.45rem,2vh),3.6rem)]",
  title: "text-[clamp(1.05rem,min(1.05vw+0.5rem,2.3vh),4rem)]",
  big: "text-[clamp(2rem,min(2.6vw+0.8rem,5.4vh),9rem)]",
};

function Board({ name, data, money, onPick, offline }: { name: string; data: ScreenData | null; money: MoneyDisplay | null; onPick: (c: DisplayCurrency) => void; offline: boolean }) {
  const [clock, setClock] = useState("");
  useEffect(() => {
    const set = () => setClock(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kigali" }));
    set();
    const t = setInterval(set, 15_000);
    return () => clearInterval(t);
  }, []);
  const total = (usd: number, rwf: number, rwfUsd: number) => (data && money ? screenTotal(money, usd, rwf, rwfUsd) : "–");
  const goal = data && money ? goalProgress(data.revenue, money.rates, data.goalRwf) : null;
  const signupTotal = data ? data.signups.reduce((s, d) => s + d.count, 0) : 0;

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-[3840px] flex-col gap-[clamp(12px,1.4vw,40px)] p-[clamp(12px,2vw,56px)] 2xl:h-dvh 2xl:overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="min-w-0 truncate text-[clamp(1.35rem,min(1.6vw+0.6rem,3.4vh),5.5rem)] font-semibold tracking-tight">{name}</h1>
          <span className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1 font-semibold ${T.small} ${offline ? "bg-danger-bg text-danger" : "bg-success-bg text-success"}`}>
            <span aria-hidden className="relative flex size-[0.6em]">
              {!offline && <span className="absolute inline-flex size-full animate-ping-soft rounded-full bg-current opacity-60" />}
              <span className="relative inline-flex size-[0.6em] rounded-full bg-current" />
            </span>
            {offline ? "Reconnecting…" : "Live"}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className={`font-semibold tabular-nums ${T.title}`}>{clock}</span>
          <div role="group" aria-label="Currency" className={`flex overflow-hidden rounded-full border border-line ${T.small}`}>
            {DISPLAY_CURRENCIES.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={money?.currency === c}
                onClick={() => onPick(c)}
                className={`min-h-[clamp(44px,4.2vh,96px)] px-[0.9em] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-white ${money?.currency === c ? "bg-brand-gradient text-white" : "text-muted hover:text-text"}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section aria-label="Today" className="grid grid-cols-1 gap-[clamp(10px,1.2vw,32px)] min-[480px]:grid-cols-2 xl:grid-cols-4">
        <Stat label="Active now" value={data ? String(data.activeNow) : "–"} hint="Used BuPulse in the last 5 minutes" />
        <Stat label="Active today" value={data ? String(data.activeToday) : "–"} hint={data ? `${signupTotal} new ${signupTotal === 1 ? "company" : "companies"} in ${data.signups.length} days` : undefined}>
          {data && <Sparkline values={data.signups.map((d) => d.count)} label={`New companies per day, last ${data.signups.length} days`} />}
        </Stat>
        <Stat label="Revenue today" value={data ? total(data.revenue.todayCents, data.revenue.todayRwfMinor, data.revenue.todayRwfUsdCents) : "–"} accent />
        <Stat label="Revenue this month" value={data ? total(data.revenue.monthCents, data.revenue.monthRwfMinor, data.revenue.monthRwfUsdCents) : "–"} accent>
          {goal && data && <GoalBar share={goal.share} goal={formatMoney(data.goalRwf, "RWF")} />}
        </Stat>
      </section>

      <div className="grid gap-[clamp(10px,1.2vw,32px)] xl:grid-cols-3 2xl:min-h-0 2xl:flex-[1]">
        <Card title="Revenue per day this month" className="xl:col-span-2">
          {data && money ? <DailyBars days={data.daily} money={money} /> : <Placeholder />}
        </Card>
        <Card title="Monthly goal">
          {goal && data ? <GoalRing share={goal.share} reached={formatMoney(goal.rwf, "RWF")} goal={formatMoney(data.goalRwf, "RWF")} daysLeft={daysLeftInMonth(data.at)} toGo={Math.max(0, data.goalRwf - goal.rwf)} /> : <Placeholder />}
        </Card>
      </div>

      <div className="grid gap-[clamp(10px,1.2vw,32px)] lg:grid-cols-2 2xl:min-h-0 2xl:flex-[1.35]">
        <Card title="Leaderboard this month">
          {data && data.leaderboard.length === 0 ? (
            <p className={`${T.body} text-muted`}>No sales agents yet.</p>
          ) : (
            money && data && <Leaderboard rows={data.leaderboard} money={money} />
          )}
        </Card>
        <Card title="Trials to follow up">
          {data && data.trials.length === 0 ? <p className={`${T.body} text-muted`}>No trials running.</p> : data && <Trials rows={data.trials} />}
        </Card>
      </div>
    </main>
  );
}

const daysLeftInMonth = (iso: string) => {
  const k = new Date(new Date(iso).getTime() + 2 * 3600_000);
  const last = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() + 1, 0)).getUTCDate();
  return last - k.getUTCDate() + 1;
};

function Stat({ label, value, accent, hint, children }: { label: string; value: string; accent?: boolean; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="glass flex min-w-0 animate-rise flex-col gap-[0.6vh] rounded-card px-[clamp(14px,1.4vw,40px)] py-[clamp(12px,1.6vh,36px)]">
      <p className={`${T.small} font-medium uppercase tracking-wider text-muted`}>{label}</p>
      <p className={`${T.big} truncate font-semibold leading-none tracking-tight tabular-nums ${accent ? "text-success" : ""}`} title={value}>
        {value}
      </p>
      {children}
      {hint && <p className={`${T.small} text-muted`}>{hint}</p>}
    </div>
  );
}

function Card({ title, className = "", children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`glass flex min-h-0 min-w-0 flex-col overflow-hidden rounded-card px-[clamp(14px,1.4vw,40px)] py-[clamp(12px,1.6vh,36px)] ${className}`}>
      <h2 className={`mb-[clamp(8px,1vh,24px)] ${T.title} font-semibold`}>{title}</h2>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

const Placeholder = () => <div className="h-full min-h-24 animate-pulse rounded-2xl bg-soft motion-reduce:animate-none" />;

/** Revenue per day: one bar per day of the month so far, today's highlighted; amounts in the chosen currency. */
function DailyBars({ days, money }: { days: ScreenData["daily"]; money: MoneyDisplay }) {
  const values = days.map((d) => Math.max(0, mixedMinor(d, money) ?? 0));
  const best = Math.max(0, ...values);
  const max = Math.max(1, best);
  const W = 100;
  const gap = days.length > 20 ? 0.6 : 1.2;
  const bar = (W - gap * (days.length - 1)) / Math.max(1, days.length);
  return (
    <figure className="flex h-[clamp(170px,26vh,340px)] flex-col gap-2 2xl:h-full">
      <svg viewBox="0 0 100 50" preserveAspectRatio="none" role="img" aria-label={`Revenue per day this month; the best day was ${compactMoney(best, money.currency)}`} className="min-h-0 w-full flex-1">
        <line x1={0} x2={100} y1={49.8} y2={49.8} stroke="var(--bp-line)" strokeWidth={0.4} vectorEffect="non-scaling-stroke" />
        {values.map((v, i) => {
          const h = v === 0 ? 0.6 : Math.max(1.5, (v / max) * 46);
          const today = i === values.length - 1;
          return (
            <rect key={days[i].day} x={i * (bar + gap)} y={50 - h} width={bar} height={h} rx={0.8} fill={today ? "url(#bp-today)" : "var(--color-pulse-blue)"} opacity={today || v > 0 ? 1 : 0.35} className="origin-bottom transition-[height,y] duration-700 motion-reduce:transition-none">
              <title>{`${days[i].day}: ${formatMoney(v, money.currency)}`}</title>
            </rect>
          );
        })}
        <defs>
          <linearGradient id="bp-today" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#7b5cff" />
            <stop offset="1" stopColor="#2f6bff" />
          </linearGradient>
        </defs>
      </svg>
      <figcaption className={`flex flex-wrap justify-between gap-x-4 ${T.small} text-muted`}>
        <span>1st to today</span>
        <span>
          Best day {compactMoney(best, money.currency)} · today {compactMoney(values[values.length - 1] ?? 0, money.currency)}
        </span>
      </figcaption>
    </figure>
  );
}

/** The month so far against the goal (RWF), as a ring, with what is left to reach it. */
function GoalRing({ share, reached, goal, daysLeft, toGo }: { share: number; reached: string; goal: string; daysLeft: number; toGo: number }) {
  const pct = Math.round(share * 100);
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex h-full flex-wrap items-center justify-center gap-[clamp(12px,1.5vw,40px)]">
      <svg viewBox="0 0 100 100" role="img" aria-label={`${pct}% of the monthly goal`} className="size-[clamp(110px,min(11vw,19vh),420px)] shrink-0 -rotate-90">
        <circle cx={50} cy={50} r={r} fill="none" stroke="var(--bp-line)" strokeWidth={10} />
        <circle cx={50} cy={50} r={r} fill="none" stroke="url(#bp-goal)" strokeWidth={10} strokeLinecap="round" strokeDasharray={`${Math.min(1, share) * c} ${c}`} className="transition-[stroke-dasharray] duration-1000 motion-reduce:transition-none" />
        <defs>
          <linearGradient id="bp-goal" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#2f6bff" />
            <stop offset="1" stopColor="#7b5cff" />
          </linearGradient>
        </defs>
        <text x={50} y={50} transform="rotate(90 50 50)" textAnchor="middle" dominantBaseline="central" fill="currentColor" fontSize={20} fontWeight={700}>
          {pct}%
        </text>
      </svg>
      <dl className={`flex min-w-0 flex-col gap-1 ${T.body}`}>
        <dt className="text-muted">So far</dt>
        <dd className="font-semibold tabular-nums">{reached}</dd>
        <dt className="mt-1 text-muted">Goal</dt>
        <dd className="font-semibold tabular-nums">{goal}</dd>
        <dd className={`mt-1 ${T.small} text-muted`}>{share >= 1 ? "Goal reached. Well done!" : `${compactMoney(toGo, "RWF")} to go, ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`}</dd>
      </dl>
    </div>
  );
}

function GoalBar({ share, goal }: { share: number; goal: string }) {
  return (
    <div className="mt-1">
      <div className="h-2 overflow-hidden rounded-full bg-soft" aria-hidden>
        <div className="h-full rounded-full bg-brand-gradient transition-[width] duration-1000 motion-reduce:transition-none" style={{ width: `${Math.min(100, Math.round(share * 100))}%` }} />
      </div>
      <p className={`mt-1 ${T.small} text-muted`}>{Math.round(share * 100)}% of {goal}</p>
    </div>
  );
}

/** A tiny line of the last days (sign-ups), no axes. */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - (v / max) * 24}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={label} className="h-[clamp(24px,3vh,64px)] w-full">
      <polygon points={`0,30 ${pts} 100,30`} fill="var(--color-pulse-violet)" opacity={0.18} />
      <polyline points={pts} fill="none" stroke="var(--color-pulse-violet)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

const MEDAL = ["bg-[linear-gradient(135deg,#f9d976,#e0a526)] text-[#3a2a00]", "bg-[linear-gradient(135deg,#e8edf3,#a9b4c2)] text-[#1f2933]", "bg-[linear-gradient(135deg,#f0b27a,#b8692e)] text-[#2d1606]"];

function Leaderboard({ rows, money }: { rows: ScreenData["leaderboard"]; money: MoneyDisplay }) {
  const part = shares(rows.map((r) => r.totalCents));
  return (
    <FitList as="ol" count={rows.length} className="flex flex-col gap-[clamp(6px,0.8vh,18px)]">
      {rows.map((r, i) => (
        <li
          key={i}
          className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-2xl px-3 py-[clamp(6px,0.9vh,20px)] ${i === 0 ? "bg-[linear-gradient(90deg,rgba(47,107,255,0.2),rgba(123,92,255,0.2))] ring-1 ring-pulse-violet/40" : "bg-soft/40"}`}
        >
          <span className={`inline-flex size-[clamp(28px,2.2vw,64px)] items-center justify-center rounded-full font-bold tabular-nums ${T.body} ${MEDAL[i] ?? "bg-soft text-muted"}`} aria-label={`Rank ${i + 1}`}>
            {i + 1}
          </span>
          <span className="min-w-0">
            <span className={`block truncate font-semibold ${T.body}`}>{r.agent}</span>
            <span className={`block truncate ${T.small} text-muted`}>
              Own {screenTotal(money, r.ownCents, r.ownRwf?.rwfMinor ?? 0, r.ownRwf?.rwfUsdCents ?? 0)} · team {screenTotal(money, r.teamShareCents, r.teamShareRwf?.rwfMinor ?? 0, r.teamShareRwf?.rwfUsdCents ?? 0)}
            </span>
          </span>
          <span className={`font-semibold tabular-nums ${T.title} ${i === 0 ? "text-success" : ""}`}>{screenTotal(money, r.totalCents, r.totalRwf?.rwfMinor ?? 0, r.totalRwf?.rwfUsdCents ?? 0)}</span>
          <span aria-hidden className="col-span-3 h-1.5 overflow-hidden rounded-full bg-soft">
            <span className="block h-full rounded-full bg-brand-gradient transition-[width] duration-1000 motion-reduce:transition-none" style={{ width: `${Math.round(part[i] * 100)}%` }} />
          </span>
        </li>
      ))}
    </FitList>
  );
}

function Trials({ rows }: { rows: ScreenData["trials"] }) {
  return (
    <FitList count={rows.length} className="flex flex-col gap-[clamp(6px,0.8vh,18px)]">
      {rows.map((t, i) => {
        const urgent = t.daysLeft <= 2;
        return (
          <li key={i} className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-2xl bg-soft/40 px-3 py-[clamp(6px,0.9vh,20px)]`}>
            <span className="min-w-0">
              <span className={`block truncate font-semibold ${T.body}`}>{t.company}</span>
              <span className={`block truncate ${T.small} text-muted`}>{t.agent ?? "Team"}</span>
            </span>
            <span className={`inline-flex min-w-[clamp(110px,9vw,280px)] flex-col gap-1 ${T.small}`}>
              <span className={`text-right font-semibold tabular-nums ${urgent ? "text-danger" : ""}`}>{fmtDays(t.daysLeft)}</span>
              <span aria-hidden className="h-2 overflow-hidden rounded-full bg-soft">
                <span className={`block h-full rounded-full ${urgent ? "bg-danger" : "bg-brand-gradient"}`} style={{ width: `${Math.max(4, Math.round(trialLeftShare(t.daysLeft, t.totalDays) * 100))}%` }} />
              </span>
            </span>
          </li>
        );
      })}
    </FitList>
  );
}

/** The new payment, big, over everything; money falls behind the card unless the viewer asked for reduced motion. */
function CelebrationOverlay({ celebration, money }: { celebration: Celebration; money: ScreenData["money"] }) {
  const card = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [reduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    // The Web Animations API is not touched by the global reduced-motion CSS rule: reduced motion gets a calm fade.
    card.current?.animate(
      reduced ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: "scale(0.85)" }, { opacity: 1, transform: "scale(1.04)", offset: 0.7 }, { opacity: 1, transform: "scale(1)" }],
      { duration: reduced ? 900 : 650, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" },
    );
    if (reduced || !canvas.current) return;
    return fallingMoney(canvas.current);
  }, [reduced]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8">
      {!reduced && <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 size-full" />}
      <div ref={card} role="status" aria-live="polite" className="relative w-full max-w-[min(90vw,1100px)] rounded-panel border border-white/15 bg-[#14141b]/95 px-[4vw] py-[5vh] text-center shadow-glow">
        <p className="text-[clamp(1.25rem,2.2vw,2.5rem)] font-medium text-muted">New payment</p>
        <p className="mt-2 truncate text-[clamp(2.25rem,5vw,6rem)] font-semibold leading-tight tracking-tight">{celebration.client}</p>
        <p className="mt-2 text-[clamp(3.5rem,9vw,11rem)] font-bold leading-none tracking-tight text-success tabular-nums">{screenMoney(money, celebration.usdCents, { minor: celebration.localMinor, currency: celebration.currency })}</p>
        <p className="mt-6 text-[clamp(1.5rem,3vw,3.5rem)] font-medium">{celebration.agent ? `Brought in by ${celebration.agent}` : "Team"}</p>
      </div>
    </div>
  );
}

/** Banknotes and coins falling for a few seconds on a canvas. Returns the clean-up. */
function fallingMoney(el: HTMLCanvasElement): () => void {
  const ctx = el.getContext("2d");
  if (!ctx) return () => undefined;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const resize = () => {
    el.width = el.clientWidth * dpr;
    el.height = el.clientHeight * dpr;
  };
  resize();
  const w = () => el.width;
  const h = () => el.height;
  const unit = Math.max(24, Math.min(w(), h()) / 18);
  const items = Array.from({ length: 70 }, () => ({
    x: Math.random() * w(),
    y: -Math.random() * h() * 1.2 - unit,
    vy: (0.35 + Math.random() * 0.5) * unit * 0.12,
    sway: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.08,
    angle: Math.random() * Math.PI,
    coin: Math.random() < 0.35,
  }));
  const started = performance.now();
  let frame = 0;
  const draw = (t: number) => {
    const elapsed = t - started;
    ctx.clearRect(0, 0, w(), h());
    for (const p of items) {
      p.y += p.vy;
      p.sway += 0.03;
      p.angle += p.spin;
      ctx.save();
      ctx.translate(p.x + Math.sin(p.sway) * unit * 0.6, p.y);
      ctx.rotate(p.angle);
      ctx.globalAlpha = elapsed > 5_000 ? Math.max(0, 1 - (elapsed - 5_000) / 1_200) : 1;
      if (p.coin) {
        ctx.fillStyle = "#f5c542";
        ctx.beginPath();
        ctx.ellipse(0, 0, unit * 0.32, unit * 0.32 * Math.abs(Math.cos(p.angle * 2)) + 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = "#3fbf7f";
        ctx.fillRect(-unit * 0.6, -unit * 0.3, unit * 1.2, unit * 0.6);
        ctx.strokeStyle = "#1d7a4c";
        ctx.lineWidth = Math.max(1, unit * 0.05);
        ctx.strokeRect(-unit * 0.5, -unit * 0.22, unit, unit * 0.44);
        ctx.fillStyle = "#1d7a4c";
        ctx.font = `700 ${unit * 0.36}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("$", 0, 1);
      }
      ctx.restore();
    }
    if (elapsed < 6_300) frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
  window.addEventListener("resize", resize);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
  };
}
