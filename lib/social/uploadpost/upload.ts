import "server-only";
import type { Network } from "../types";
import { startUpload, uploadStatus } from "./client";

// What every Upload-Post upload shares (./linkedin.ts, ./tiktok.ts): BuPulse's own request id, the asynchronous start,
// a few status checks, and reading one platform's entry out of the answers.
// https://docs.upload-post.com/api/upload-status and https://docs.upload-post.com/guides/async-uploads

export type Json = Record<string, unknown>;
export const asObject = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
export const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
export const https = (v: unknown) => (typeof v === "string" && /^https:\/\//.test(v) ? v : undefined);

/** How long a publish waits for Upload-Post to finish before taking "accepted" for an answer (tests set 0). */
export const timing = { pollMs: 4_000, polls: 3 };

/** One platform's part of an upload: finished (its entry), failed (what it said), or still on its way. */
export type Entry = { state: "done"; entry: Json } | { state: "failed"; message: string; code?: string } | { state: "pending" };

// A skipped platform names why (skip_reason "profile_platform_not_configured": the account was removed).
const failedOf = (entry: Json): Entry => ({ state: "failed", message: str(entry.skip_reason) ?? str(entry.error) ?? str(entry.message) ?? "", ...(str(entry.error_code) ? { code: str(entry.error_code) } : {}) });

/** The platform's result of an upload that finished at once ({ results: { <platform>: {...} } }). */
export function syncEntry(answer: unknown, platform: Network): Entry {
  const entry = asObject(asObject(asObject(answer).results)[platform]);
  if (entry.success === true) return { state: "done", entry };
  if (entry.success === false) return failedOf(entry);
  return { state: "pending" };
}

/** The platform's result of an asynchronous upload from its status: done, failed, or still on its way. */
export function statusEntry(answer: unknown, platform: Network): Entry {
  const a = asObject(answer);
  const results = Array.isArray(a.results) ? a.results.map(asObject) : [];
  const entry = results.find((r) => r.platform === platform);
  const top = str(a.status);
  const status = str(entry?.status);
  const waiting = status === "queued" || status === "processing" || status === "retryable";
  if (entry && (status === "failed" || status === "skipped" || (entry.success === false && !waiting))) return failedOf(entry);
  if (top === "failed") return { state: "failed", message: str(a.message) ?? "" };
  if (entry && (status === "completed" || (top === "completed" && !waiting))) return { state: "done", entry };
  return { state: "pending" };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts the upload (asynchronous: Upload-Post fetches the media from its signed link in the background), then checks
 * its status a few times. Still pending after them means accepted: Upload-Post keeps going (and retries) on its own.
 * `requestId` is Upload-Post's id for the upload, BuPulse's own when the answer has none.
 */
export async function runUpload(network: Network, path: "/upload_text" | "/upload_photos" | "/upload", form: FormData, ownRequestId: string): Promise<{ outcome: Entry; requestId: string }> {
  const answer = await startUpload<{ request_id?: string; results?: unknown }>(network, path, form);
  let outcome = syncEntry(answer, network);
  const requestId = str(answer.request_id) ?? ownRequestId;
  for (let i = 0; outcome.state === "pending" && i < timing.polls; i += 1) {
    await sleep(timing.pollMs);
    // A status check that fails says nothing about the post: keep the last answer.
    const status = await uploadStatus(network, requestId).catch(() => null);
    if (status) outcome = statusEntry(status, network);
  }
  return { outcome, requestId };
}
