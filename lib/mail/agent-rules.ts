import { cleanAddress, type Addr } from "./addresses";
import { cleanMessageId } from "./threading";

// The B Mail agent API's pure rules (docs/mail-crm/AGENT_API.md): key format, the inbox cursor, send input checks.
// No database here, so tests/mail/agent.test.ts covers all of it.

export const AGENT_KEY_PREFIX = "bpm_live_";
export const AGENT_DAILY_MAX = 100; // a key never gets more than the team's whole free plan
export const AGENT_LIST_MAX = 100;
export const AGENT_LIST_DEFAULT = 50;
export const AGENT_TEXT_MAX = 50_000;
export const AGENT_SUBJECT_MAX = 300;

/** A new agent key: bpm_live_ + 32 random bytes in base64url, and its first characters to tell keys apart. */
export function generateAgentKey(): { key: string; prefix: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  const key = AGENT_KEY_PREFIX + btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { key, prefix: key.slice(0, AGENT_KEY_PREFIX.length + 4) };
}

/** The key from "Authorization: Bearer bpm_live_...", or null. */
export function bearerAgentKey(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  if (!match || !match[1].startsWith(AGENT_KEY_PREFIX) || match[1].length > 200) return null;
  return match[1];
}

/** The inbox cursor: where the last page ended (createdAt, then id), opaque to the agent. */
export type Cursor = { at: Date; id: string };

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.at.toISOString()}|${c.id}`, "utf8").toString("base64url");
}

export function decodeCursor(value: string | null): Cursor | null | "invalid" {
  if (value === null || value === "") return null;
  if (value.length > 200 || !/^[A-Za-z0-9_-]+$/.test(value)) return "invalid";
  const [iso, id, extra] = Buffer.from(value, "base64url").toString("utf8").split("|");
  const at = new Date(iso ?? "");
  if (extra !== undefined || !id || !/^[a-z0-9]{10,40}$/i.test(id) || Number.isNaN(at.getTime())) return "invalid";
  return { at, id };
}

/** ?limit= for the inbox list: 1..100, 50 by default. */
export function parseLimit(raw: string | null): number | null {
  if (raw === null) return AGENT_LIST_DEFAULT;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= AGENT_LIST_MAX ? n : null;
}

export type AgentSendInput = { to: Addr; subject: string; text: string; inReplyTo: string | null };

/**
 * Checks a send request: one recipient (an address, or { name, address }), a subject, plain text, and optionally the
 * RFC Message-ID being answered. Cold outreach goes to one person per email, so there is no cc, bcc or list.
 */
export function parseSendInput(body: unknown): { ok: true; input: AgentSendInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send a JSON object." };
  const b = body as Record<string, unknown>;
  const rawTo = b.to;
  const toAddress = typeof rawTo === "string" ? rawTo : rawTo && typeof rawTo === "object" ? (rawTo as Record<string, unknown>).address : null;
  const toName = rawTo && typeof rawTo === "object" ? (rawTo as Record<string, unknown>).name : "";
  const address = typeof toAddress === "string" ? cleanAddress(toAddress) : null;
  if (!address) return { ok: false, error: "to must be one email address, or { \"name\": ..., \"address\": ... }." };
  const name = typeof toName === "string" ? toName.replace(/[\r\n<>"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) : "";
  if (typeof b.subject !== "string" || !b.subject.trim()) return { ok: false, error: "subject is required." };
  if (/[\r\n]/.test(b.subject)) return { ok: false, error: "subject must be one line." };
  if (b.subject.length > AGENT_SUBJECT_MAX) return { ok: false, error: `subject is longer than ${AGENT_SUBJECT_MAX} characters.` };
  if (typeof b.text !== "string" || !b.text.trim()) return { ok: false, error: "text is required." };
  if (b.text.length > AGENT_TEXT_MAX) return { ok: false, error: `text is longer than ${AGENT_TEXT_MAX} characters.` };
  let inReplyTo: string | null = null;
  if (b.inReplyTo !== undefined && b.inReplyTo !== null && b.inReplyTo !== "") {
    if (typeof b.inReplyTo !== "string" || b.inReplyTo.length > 500) return { ok: false, error: "inReplyTo must be a Message-ID." };
    inReplyTo = cleanMessageId(b.inReplyTo);
    if (!inReplyTo) return { ok: false, error: "inReplyTo must be a Message-ID." };
  }
  return { ok: true, input: { to: { name, address }, subject: b.subject.trim(), text: b.text.replace(/\r\n/g, "\n"), inReplyTo } };
}

/** Sends this key may still make today: its own limit, and never more than the team has left. */
export function agentSendsLeft(o: { dailyLimit: number; keySentToday: number; teamLeft: number }): number {
  return Math.max(0, Math.min(o.dailyLimit - o.keySentToday, o.teamLeft));
}

/** A key's daily limit from the console: a whole number from 1 to AGENT_DAILY_MAX. */
export function parseDailyLimit(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= AGENT_DAILY_MAX ? n : null;
}
