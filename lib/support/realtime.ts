import "server-only";
import { logError } from "@/lib/errors";
import { REALTIME_EVENT, STAFF_TOPICS, agentTopic, conversationTopic, visitorTopic, type RealtimeEvent } from "./contract";
import { topicSecret } from "./tokens";

// Real-time pings from the server: Supabase Realtime's REST broadcast with the service key, so no socket is held
// (docs/research/support-chat-research.md 3.1). Payloads are the small RealtimeEvent objects; clients fetch the details
// over REST. Staff topics are private (RLS on realtime.messages, see the migration); the visitor's sv:<secret> topic is
// public and only ever gets content-free pings. Sending never throws: a lost ping is covered by the 5 s poll fallback.

type Outgoing = { topic: string; event: RealtimeEvent; private: boolean };

/** Where a change goes. `visitor` is a conversation id: its visitor's topic gets the ping, never a draft or any text. */
export async function broadcast(event: RealtimeEvent, to: { inbox?: boolean; visitors?: boolean; conversation?: string; agent?: string; visitor?: string }) {
  const out: Outgoing[] = [];
  if (to.inbox) out.push({ topic: STAFF_TOPICS.inbox, event, private: true });
  if (to.visitors) out.push({ topic: STAFF_TOPICS.visitors, event, private: true });
  if (to.conversation) out.push({ topic: conversationTopic(to.conversation), event, private: true });
  if (to.agent) out.push({ topic: agentTopic(to.agent), event, private: true });
  if (to.visitor) {
    try {
      const safe: RealtimeEvent = event.type === "typing" ? { type: "typing", conversationId: event.conversationId, who: event.who } : event;
      out.push({ topic: visitorTopic(await topicSecret(to.visitor)), event: safe, private: false });
    } catch (error) {
      await logError(error, { source: "support.realtime", level: "warn" });
    }
  }
  await send(out);
}

async function send(messages: Outgoing[]) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!messages.length || !url || !key) return;
  try {
    const response = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ messages: messages.map((m) => ({ topic: m.topic, event: REALTIME_EVENT, payload: m.event, private: m.private })) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) await logError(new Error(`Realtime broadcast answered ${response.status}`), { source: "support.realtime", level: "warn" });
  } catch (error) {
    await logError(error, { source: "support.realtime", level: "warn" });
  }
}

/** What a browser needs to join Supabase Realtime: the project URL and the publishable (anon) key, never a secret. */
export function realtimeConnection(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && anonKey ? { url, anonKey } : null;
}
