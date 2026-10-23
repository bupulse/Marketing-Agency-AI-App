// The visitor chat's thin client for /api/support/v1 (lib/support/contract.ts). One interface, two makers: the real
// one over fetch, and the mock (./mock.ts, development and tests only) so the widget can be built before the server.
import {
  HEARTBEAT_RPC,
  type HeartbeatResult,
  REALTIME_EVENT,
  SUPPORT_API,
  type ConversationView,
  type MessageView,
  type RealtimeEvent,
  type SendMessageResponse,
  type VisitResponse,
} from "../contract";
import type { z } from "zod";
import type { prechatBody, ratingBody, sendMessageBody, visitBody } from "../contract";
import { KEYS, read, write } from "./storage";

export type Visit = VisitResponse;

export type MessagesResponse = { messages: MessageView[]; status: ConversationView["status"]; aiActive: boolean; agent: ConversationView["agent"] };

export type Me = VisitResponse["me"];

export class SupportApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type RealtimeStatus = "connecting" | "live" | "down";

export interface SupportClient {
  visit(body: z.input<typeof visitBody>): Promise<Visit>;
  prechat(body: z.input<typeof prechatBody>): Promise<{ me: Me }>;
  /** The first message opens the conversation. */
  start(body: z.input<typeof sendMessageBody>): Promise<SendMessageResponse>;
  send(conversationId: string, body: z.input<typeof sendMessageBody>): Promise<SendMessageResponse>;
  messages(conversationId: string, after?: string): Promise<MessagesResponse>;
  typing(conversationId: string, draft?: string): Promise<void>;
  human(conversationId: string): Promise<SendMessageResponse>;
  upload(conversationId: string, file: Blob, meta: { mime: string; fileName?: string; durationSec?: number }): Promise<{ attachmentId: string }>;
  rate(conversationId: string, body: z.input<typeof ratingBody>): Promise<void>;
  end(conversationId: string): Promise<void>;
  /** Straight to Supabase (HEARTBEAT_RPC): { ok, unread } or { ok: false, error: "expired" | "unknown" }; null when it could not ask. */
  heartbeat(path: string, title?: string): Promise<HeartbeatResult | null>;
  /** Listens on the visitor's public topic; returns the way to stop. */
  subscribe(topic: string, onEvent: (e: RealtimeEvent) => void, onStatus: (s: RealtimeStatus) => void): () => void;
}

type Fetch = typeof fetch;

/**
 * The real client. The visit token lives in sessionStorage: every page load sends it to POST /visit, which continues
 * the same visit (or answers a new token once it expired).
 */
export function createHttpClient(opts: { base?: string; fetch?: Fetch } = {}): SupportClient {
  const base = opts.base ?? SUPPORT_API;
  const f: Fetch = opts.fetch ?? ((...a) => fetch(...a));
  let token: string | null = read("session", KEYS.visitToken);
  let rt: { url: string; anonKey: string } | null = null;
  let lastVisit: z.input<typeof visitBody> | null = null;

  async function call<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
    let res: Response;
    try {
      res = await f(`${base}${path}`, {
        method,
        credentials: "same-origin",
        headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { "X-Support-Visit": token } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new SupportApiError(0, "network", "No connection");
    }
    // An expired or unknown visit token: open the visit again once, then repeat the call.
    if ((res.status === 401 || res.status === 404) && !retried && lastVisit && path !== "/visit") {
      await visit(lastVisit);
      return call<T>(method, path, body, true);
    }
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
      throw new SupportApiError(res.status, err?.code ?? "error", err?.message ?? res.statusText);
    }
    return data as T;
  }

  async function visit(body: z.input<typeof visitBody>): Promise<Visit> {
    lastVisit = body;
    const v = await call<Visit>("POST", "/visit", body);
    token = v.visitToken;
    write("session", KEYS.visitToken, token);
    rt = v.realtime;
    return v;
  }

  return {
    visit,
    prechat: (body) => call("POST", "/prechat", body),
    start: (body) => call("POST", "/conversations", body),
    send: (id, body) => call("POST", `/conversations/${encodeURIComponent(id)}/messages`, body),
    messages: (id, after) => call("GET", `/conversations/${encodeURIComponent(id)}/messages${after ? `?after=${encodeURIComponent(after)}` : ""}`),
    typing: (id, draft) => call("POST", `/conversations/${encodeURIComponent(id)}/typing`, draft === undefined ? {} : { draft: draft.slice(0, 500) }),
    human: (id) => call("POST", `/conversations/${encodeURIComponent(id)}/human`, {}),
    async upload(id, file, meta) {
      const c = encodeURIComponent(id);
      const u = await call<{ attachmentId: string; uploadUrl: string; token: string }>("POST", `/conversations/${c}/uploads`, {
        mime: meta.mime,
        bytes: file.size,
        fileName: meta.fileName?.slice(0, 200),
        durationSec: meta.durationSec,
      });
      let put: Response;
      try {
        put = await f(u.uploadUrl, { method: "PUT", headers: { "Content-Type": meta.mime }, body: file });
      } catch {
        throw new SupportApiError(0, "network", "No connection");
      }
      if (!put.ok) throw new SupportApiError(put.status >= 500 ? put.status : 400, "upload_failed", "Upload failed");
      return call("POST", `/conversations/${c}/uploads/${encodeURIComponent(u.attachmentId)}/done`, {});
    },
    rate: (id, body) => call("POST", `/conversations/${encodeURIComponent(id)}/rating`, body),
    end: (id) => call("POST", `/conversations/${encodeURIComponent(id)}/end`, {}),
    async heartbeat(path, title) {
      if (!rt || !token) return null;
      // PostgREST's RPC endpoint with the public key only: the function itself checks the visit token.
      const res = await f(`${rt.url.replace(/\/$/, "")}/rest/v1/rpc/${HEARTBEAT_RPC}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: rt.anonKey },
        body: JSON.stringify({ p_token: token, p_path: path, p_title: title ?? null }),
      }).catch(() => null);
      if (!res?.ok) return null;
      const data = (await res.json().catch(() => null)) as HeartbeatResult | null;
      return data && typeof data === "object" && typeof data.ok === "boolean" ? data : null;
    },
    subscribe(topic, onEvent, onStatus) {
      if (!rt) {
        onStatus("down");
        return () => {};
      }
      const { url, anonKey } = rt;
      let stop: (() => void) | null = null;
      let cancelled = false;
      onStatus("connecting");
      // supabase-js only loads once a panel opens: the closed button needs none of it.
      void import("@supabase/supabase-js")
        .then(({ createClient }) => {
          if (cancelled) return;
          const sb = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "bp-sc-realtime" } });
          const channel = sb
            .channel(topic, { config: { broadcast: { self: false } } })
            .on("broadcast", { event: REALTIME_EVENT }, (msg) => onEvent(msg.payload as RealtimeEvent))
            .subscribe((status) => onStatus(status === "SUBSCRIBED" ? "live" : "down"));
          stop = () => {
            void sb.removeChannel(channel);
            void sb.realtime.disconnect();
          };
        })
        .catch(() => onStatus("down"));
      return () => {
        cancelled = true;
        stop?.();
      };
    },
  };
}
