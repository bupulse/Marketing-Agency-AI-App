// Video Lab (docs/VIDEO_ENGINE.md): tests and spending, kept as files in video-lab/data (git-ignored).
// Every paid call is written to ledger.jsonl before the answer is used, and the daily cap is checked before each call.
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { MotionSpec } from "@/lib/video-engine/spec";
import type { DesignUsage } from "@/lib/video-engine/designer";

const DATA = path.resolve("video-lab/data");
const JOBS = path.join(DATA, "jobs");
const VIDEOS = path.join(DATA, "videos");
const LEDGER = path.join(DATA, "ledger.jsonl");

export const DAILY_CAP_USD = Number(process.env.VIDEO_LAB_DAILY_USD || 5);

export type LabJob = {
  id: string;
  createdAt: string;
  engine: "claude" | "seedance";
  businessId: string;
  businessName: string;
  productId: string;
  productName: string;
  styleId: string;
  hookId: string;
  ratio: string;
  seconds: number;
  note: string | null;
  photoIds: string[];
  spec: MotionSpec | null;
  usage: DesignUsage[];
  costUsd: number;
  /** What the Claude calls would cost through the API (equal to costUsd when the API was used). */
  apiEquivalentUsd?: number;
  /** How Claude was reached: the API key, or the owner's subscription (tests only). */
  billedTo?: "api" | "subscription";
  status: "designed" | "failed";
  error: string | null;
  video: { bytes: number; renderMs: number; savedAt: string } | null;
  edited: boolean;
};

type LedgerRow = { at: string; jobId: string; kind: string; model: string; inputTokens: number; outputTokens: number; costUsd: number; billedTo?: string; apiEquivalentUsd?: number };

/** Today's date in Kigali (UTC+2), the day the cap counts. */
export const kigaliDay = (d = new Date()) => new Date(d.getTime() + 2 * 3600_000).toISOString().slice(0, 10);

export async function spentToday(): Promise<number> {
  let text = "";
  try {
    text = await fs.readFile(LEDGER, "utf8");
  } catch {
    return 0;
  }
  const today = kigaliDay();
  const total = text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LedgerRow)
    .filter((r) => kigaliDay(new Date(r.at)) === today)
    .reduce((s, r) => s + r.costUsd, 0);
  return Math.round(total * 10_000) / 10_000;
}

export async function record(jobId: string, kind: string, usage: DesignUsage[]): Promise<void> {
  await fs.mkdir(DATA, { recursive: true });
  const rows = usage.map((u): LedgerRow => ({ at: new Date().toISOString(), jobId, kind, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, costUsd: u.costUsd, billedTo: u.billedTo, apiEquivalentUsd: u.apiEquivalentUsd }));
  if (rows.length) await fs.appendFile(LEDGER, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export const newJobId = () => `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 8)}`;
const safeId = (id: string) => /^[0-9]{8}-[0-9a-f]{8}$/.test(id);

export async function saveJob(job: LabJob): Promise<void> {
  await fs.mkdir(JOBS, { recursive: true });
  await fs.writeFile(path.join(JOBS, `${job.id}.json`), JSON.stringify(job, null, 2));
}

export async function getJob(id: string): Promise<LabJob | null> {
  if (!safeId(id)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(JOBS, `${id}.json`), "utf8")) as LabJob;
  } catch {
    return null;
  }
}

export async function listJobs(): Promise<Omit<LabJob, "spec">[]> {
  let files: string[] = [];
  try {
    files = await fs.readdir(JOBS);
  } catch {
    return [];
  }
  const jobs = await Promise.all(files.filter((f) => f.endsWith(".json")).map((f) => getJob(f.slice(0, -5))));
  return jobs
    .filter((j): j is LabJob => !!j)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 100)
    .map((job) => {
      const summary: Omit<LabJob, "spec"> & { spec?: unknown } = { ...job };
      delete summary.spec;
      return summary;
    });
}

export async function saveVideo(id: string, bytes: Buffer): Promise<string> {
  if (!safeId(id)) throw new Error("Bad job id");
  await fs.mkdir(VIDEOS, { recursive: true });
  const file = path.join(VIDEOS, `${id}.mp4`);
  await fs.writeFile(file, bytes);
  return file;
}

export async function readVideo(id: string): Promise<Buffer | null> {
  if (!safeId(id)) return null;
  try {
    return await fs.readFile(path.join(VIDEOS, `${id}.mp4`));
  } catch {
    return null;
  }
}
