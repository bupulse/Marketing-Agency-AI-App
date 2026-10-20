import "server-only";
import { registerJobHandler } from "@/lib/jobs/due";
import { questionTimedOut, resumeAfterDelay } from "./engine";

// The automations' due jobs (lib/jobs/due.ts): the end of a "Wait" step, and a question nobody answered in time.

const payloadOf = (value: unknown): { runId?: string; nodeId?: string } => (value && typeof value === "object" && !Array.isArray(value) ? (value as { runId?: string; nodeId?: string }) : {});

registerJobHandler("automation.resume", (job) => resumeAfterDelay(payloadOf(job.payload)));
registerJobHandler("automation.timeout", (job) => questionTimedOut(payloadOf(job.payload)));
