"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { POLL_MS, nextSound, screenMoney, screenTotal, type Celebration, type ScreenData } from "@/lib/screen/shared";

// The sales room TV. Dark whatever the theme (the "dark" class switches the tokens for this subtree), type sized for a
// room, 16:9 first. One big "Start screen" button comes first: browsers only let a page play sound after a click, so
// that click unlocks the audio element used for every celebration afterwards.

const SOUND_KEY = "bp-screen-last-sound";
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
        <Board name={name} data={data} offline={status === "offline"} />
      )}
      {current && data && <CelebrationOverlay key={current.id} celebration={current} money={data.money} />}
    </div>
  );
}

const fmtDays = (d: number) => (d === 0 ? "Ends today" : d === 1 ? "1 day" : `${d} days`);

function Board({ name, data, offline }: { name: string; data: ScreenData | null; offline: boolean }) {
  const [clock, setClock] = useState("");
  useEffect(() => {
    const set = () => setClock(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kigali" }));
    set();
    const t = setInterval(set, 15_000);
    return () => clearInterval(t);
  }, []);

  return (
    <main className="relative flex min-h-dvh flex-col gap-[2.2vh] p-[clamp(16px,2.5vw,48px)]">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-[clamp(1.5rem,2.4vw,2.75rem)] font-semibold tracking-tight">{name}</h1>
        <div className="flex items-center gap-6 text-[clamp(1.25rem,2vw,2.5rem)] font-medium tabular-nums">
          <span className={offline ? "text-danger" : "text-success"}>{offline ? "Reconnecting…" : "● Live"}</span>
          <span>{clock}</span>
        </div>
      </header>

      <section aria-label="Today" className="grid grid-cols-2 gap-[1.5vw] lg:grid-cols-4">
        <Stat label="Active now" value={data ? String(data.activeNow) : "–"} />
        <Stat label="Active today" value={data ? String(data.activeToday) : "–"} />
        <Stat label="Revenue today" value={data ? screenTotal(data.money, data.revenue.todayCents, data.revenue.todayRwfMinor, data.revenue.todayRwfUsdCents) : "–"} accent />
        <Stat label="Revenue this month" value={data ? screenTotal(data.money, data.revenue.monthCents, data.revenue.monthRwfMinor, data.revenue.monthRwfUsdCents) : "–"} accent />
      </section>

      <div className="grid min-h-0 flex-1 gap-[1.5vw] lg:grid-cols-2">
        <Card title="Trials to follow up">
          {data && data.trials.length === 0 ? (
            <p className="text-[clamp(1.1rem,1.6vw,1.75rem)] text-muted">No trials running.</p>
          ) : (
            <table className="w-full text-left text-[clamp(1.1rem,1.7vw,2rem)]">
              <thead className="text-[0.7em] uppercase tracking-wider text-muted">
                <tr><th scope="col" className="pb-2 font-medium">Company</th><th scope="col" className="pb-2 font-medium">Left</th><th scope="col" className="pb-2 font-medium">Agent</th></tr>
              </thead>
              <tbody>
                {data?.trials.map((t, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="max-w-0 truncate py-[0.5vh] pr-4 font-medium">{t.company}</td>
                    <td className={`whitespace-nowrap py-[0.5vh] pr-4 tabular-nums ${t.daysLeft <= 2 ? "text-danger" : ""}`}>{fmtDays(t.daysLeft)}</td>
                    <td className="truncate py-[0.5vh] text-muted">{t.agent ?? "Team"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Leaderboard this month">
          {data && data.leaderboard.length === 0 ? (
            <p className="text-[clamp(1.1rem,1.6vw,1.75rem)] text-muted">No sales agents yet.</p>
          ) : (
            <table className="w-full text-left text-[clamp(1.1rem,1.7vw,2rem)]">
              <thead className="text-[0.7em] uppercase tracking-wider text-muted">
                <tr>
                  <th scope="col" className="pb-2 font-medium">Agent</th>
                  <th scope="col" className="pb-2 text-right font-medium">Own</th>
                  <th scope="col" className="pb-2 text-right font-medium">Team share</th>
                  <th scope="col" className="pb-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data?.leaderboard.map((r, i) => (
                  <tr key={i} className="border-t border-line tabular-nums">
                    <td className="max-w-0 truncate py-[0.5vh] pr-4 font-medium">
                      <span className="mr-3 inline-block w-[1.4em] text-muted">{i + 1}</span>
                      {r.agent}
                    </td>
                    <td className="py-[0.5vh] pl-2 text-right">{screenMoney(data.money, r.ownCents)}</td>
                    <td className="py-[0.5vh] pl-2 text-right text-muted">{screenMoney(data.money, r.teamShareCents)}</td>
                    <td className="py-[0.5vh] pl-2 text-right font-semibold">{screenMoney(data.money, r.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="glass rounded-card px-[1.6vw] py-[2vh]">
      <p className="text-[clamp(1rem,1.5vw,1.75rem)] font-medium text-muted">{label}</p>
      <p className={`mt-1 text-[clamp(2.5rem,5.2vw,6.5rem)] font-semibold leading-none tracking-tight tabular-nums ${accent ? "text-success" : ""}`}>{value}</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass flex min-h-0 flex-col overflow-hidden rounded-card px-[1.6vw] py-[2vh]">
      <h2 className="mb-[1.2vh] text-[clamp(1.25rem,2vw,2.25rem)] font-semibold">{title}</h2>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
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
