// What the server PC's job loop sends every minute (scripts/self-host/windows/cron-loop.ps1), checked and capped before
// it is stored. Pure, no imports: tests/monitor/heartbeat.test.ts. Unknown fields are dropped, long text is cut, numbers
// out of range become null, and only the machine name is required, so a PC that cannot read one value still reports.

export const HEARTBEAT_MAX_BYTES = 8_192;

/** The three scheduled tasks on the PC (scripts/self-host/windows/install.ps1). */
export const PC_TASKS = ["BuPulse server", "BuPulse tunnel", "BuPulse jobs"] as const;
const TASK_STATES = ["Running", "Ready", "Disabled", "Queued", "Unknown", "Missing"] as const;
export type TaskState = (typeof TASK_STATES)[number];

export type HeartbeatDisk = { name: string; roles: ("system" | "repo")[]; freeGb: number | null; totalGb: number | null };
export type HeartbeatTask = { name: string; state: TaskState };

export type HeartbeatInput = {
  machine: string;
  os: string | null;
  bootAt: Date | null;
  cpuPercent: number | null;
  memUsedMb: number | null;
  memTotalMb: number | null;
  disks: HeartbeatDisk[];
  tasks: HeartbeatTask[];
  serverListening: boolean | null;
  nodeVersion: string | null;
  cloudflaredVersion: string | null;
};

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

const num = (v: unknown, min: number, max: number, digits = 0): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** PowerShell turns a one-item list into a plain object; take both. */
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v && typeof v === "object" ? [v] : []);

function date(v: unknown, now: Date): Date | null {
  if (typeof v !== "string" || v.length > 40) return null;
  const d = new Date(v);
  const t = d.getTime();
  // A boot time is in the past, and not before 2000.
  return Number.isFinite(t) && t <= now.getTime() + 5 * 60_000 && t >= Date.UTC(2000, 0, 1) ? d : null;
}

function disk(v: unknown): HeartbeatDisk | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const name = text(o.name, 8);
  if (!name || !/^[A-Za-z]:?$/.test(name)) return null;
  const roles = (typeof o.roles === "string" ? [o.roles] : list(o.roles)).filter((r): r is "system" | "repo" => r === "system" || r === "repo");
  const totalGb = num(o.totalGb, 0, 1_000_000, 1);
  const freeGb = num(o.freeGb, 0, 1_000_000, 1);
  return { name: `${name[0].toUpperCase()}:`, roles: [...new Set(roles)], freeGb: totalGb !== null && freeGb !== null && freeGb > totalGb ? totalGb : freeGb, totalGb };
}

function task(v: unknown): HeartbeatTask | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const name = text(o.name, 60);
  if (!name || !(PC_TASKS as readonly string[]).includes(name)) return null;
  const state = TASK_STATES.find((s) => s.toLowerCase() === String(o.state ?? "").toLowerCase()) ?? "Unknown";
  return { name, state };
}

export function parseHeartbeat(raw: unknown, now = new Date()): { ok: true; value: HeartbeatInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Send a JSON object." };
  const o = raw as Record<string, unknown>;
  const machine = text(o.machine, 64);
  if (!machine) return { ok: false, error: "machine is required." };
  const memTotalMb = num(o.memTotalMb, 1, 16_000_000);
  let memUsedMb = num(o.memUsedMb, 0, 16_000_000);
  if (memUsedMb !== null && memTotalMb !== null && memUsedMb > memTotalMb) memUsedMb = memTotalMb;
  const disks: HeartbeatDisk[] = [];
  for (const d of list(o.disks).slice(0, 4).map(disk)) if (d && !disks.some((x) => x.name === d.name)) disks.push(d);
  const tasks: HeartbeatTask[] = [];
  for (const t of list(o.tasks).slice(0, 6).map(task)) if (t && !tasks.some((x) => x.name === t.name)) tasks.push(t);
  return {
    ok: true,
    value: {
      machine,
      os: text(o.os, 120),
      bootAt: date(o.bootAt, now),
      cpuPercent: num(o.cpuPercent, 0, 100),
      memUsedMb,
      memTotalMb,
      disks,
      tasks,
      serverListening: typeof o.serverListening === "boolean" ? o.serverListening : null,
      nodeVersion: text(o.nodeVersion, 40),
      cloudflaredVersion: text(o.cloudflaredVersion, 80),
    },
  };
}
