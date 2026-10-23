// Typed client for the agent API (lib/support/contract.ts, /api/support/v1/agent/*), used by the support app and later
// its desktop and phone apps. No server imports. The token is the agent's Supabase access token (AAL2); every call
// asks for it again, so a refreshed session is picked up without a reload.
import { z } from "zod";
import {
  SUPPORT_API,
  type AgentMe,
  type Assist,
  type ConversationDetail,
  type ConversationListItem,
  type DepartmentKey,
  type LiveVisitor,
  type MessageView,
  type Stats,
  type agentMessageBody,
  type assignBody,
  type rewriteBody,
} from "@/lib/support/contract";

export type ListView = "mine" | "waiting" | "ai" | "all";
export type Availability = AgentMe["availability"];
export type VisitorGroup = LiveVisitor["group"];
export type TeamMember = { id: string; name: string; availability: Availability; departments: DepartmentKey[]; openChats: number; maxChats: number };
export type PushDevice = { endpoint: string; keys: { p256dh: string; auth: string }; label?: string };

/** The agent API, as the app sees it. The real client and the mock (dev and tests) both implement it. */
export interface AgentApi {
  me(): Promise<AgentMe>;
  setAvailability(availability: Availability): Promise<AgentMe>;
  conversations(view: ListView, q?: string, after?: string): Promise<{ items: ConversationListItem[]; next: string | null }>;
  conversation(id: string): Promise<ConversationDetail>;
  send(id: string, body: z.input<typeof agentMessageBody>): Promise<{ message: MessageView }>;
  takeover(id: string): Promise<ConversationDetail>;
  release(id: string): Promise<ConversationDetail>;
  assign(id: string, body: z.input<typeof assignBody>): Promise<ConversationDetail>;
  close(id: string): Promise<ConversationDetail>;
  reopen(id: string): Promise<ConversationDetail>;
  typing(id: string): Promise<void>;
  assist(id: string): Promise<Assist>;
  rewrite(body: z.input<typeof rewriteBody>): Promise<{ text: string }>;
  liveVisitors(): Promise<{ items: LiveVisitor[]; counts: Record<VisitorGroup, number> }>;
  inviteVisitor(visitorId: string, text: string): Promise<{ conversationId: string }>;
  stats(from: string, to: string): Promise<Stats>;
  /** Who a chat can be transferred to (GET /agent/team, asked of sc-core). */
  team(): Promise<{ agents: TeamMember[] }>;
  realtime(): Promise<{ url: string; anonKey: string; topics: string[] }>;
  addDevice(device: PushDevice): Promise<{ id: string }>;
  removeDevice(id: string): Promise<void>;
}

/** A refused call: `status` 401 means the session ended (signed out, locked), so the app goes to the sign-in page. */
export class AgentApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export function createAgentApi({ getToken, fetcher = (i, init) => fetch(i, init), origin = "" }: { getToken: () => Promise<string | null>; fetcher?: Fetch; origin?: string }): AgentApi {
  async function call<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
    const token = await getToken();
    if (!token) throw new AgentApiError(401, "signed_out", "Your session ended. Sign in again.");
    let res: Response;
    try {
      res = await fetcher(`${origin}${SUPPORT_API}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
    } catch {
      throw new AgentApiError(0, "offline", "No connection. Retrying…");
    }
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
      throw new AgentApiError(res.status, err?.code ?? "error", err?.message ?? "Something went wrong. Please try again.");
    }
    return data as T;
  }
  const enc = encodeURIComponent;
  const qs = (params: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
    return s ? `?${s}` : "";
  };
  return {
    me: () => call("GET", "/agent/me"),
    setAvailability: (availability) => call("PATCH", "/agent/me", { availability }),
    conversations: (view, q, after) => call("GET", `/agent/conversations${qs({ view, q, after })}`),
    conversation: (id) => call("GET", `/agent/conversations/${enc(id)}`),
    send: (id, body) => call("POST", `/agent/conversations/${enc(id)}/messages`, body),
    takeover: (id) => call("POST", `/agent/conversations/${enc(id)}/takeover`),
    release: (id) => call("POST", `/agent/conversations/${enc(id)}/release`),
    assign: (id, body) => call("POST", `/agent/conversations/${enc(id)}/assign`, body),
    close: (id) => call("POST", `/agent/conversations/${enc(id)}/close`),
    reopen: (id) => call("POST", `/agent/conversations/${enc(id)}/reopen`),
    typing: (id) => call("POST", `/agent/conversations/${enc(id)}/typing`),
    assist: (id) => call("GET", `/agent/conversations/${enc(id)}/assist`),
    rewrite: (body) => call("POST", "/agent/assist/rewrite", body),
    liveVisitors: () => call("GET", "/agent/visitors/live"),
    inviteVisitor: (visitorId, text) => call("POST", `/agent/visitors/${enc(visitorId)}/invite`, { text }),
    stats: (from, to) => call("GET", `/agent/stats${qs({ from, to })}`),
    team: () => call("GET", "/agent/team"),
    realtime: () => call("GET", "/agent/realtime"),
    addDevice: (device) => call("POST", "/agent/devices", { kind: "webpush", ...device }),
    removeDevice: (id) => call("DELETE", `/agent/devices/${enc(id)}`),
  };
}
