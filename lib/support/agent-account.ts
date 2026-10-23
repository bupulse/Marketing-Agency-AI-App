import "server-only";
import type { z } from "zod";
import { prisma } from "@/lib/db";
import { allowedEndpoint } from "@/lib/push/service";
import { agentMe, type AgentSession } from "./agent-auth";
import { STAFF_TOPICS, agentTopic, type AgentMe, type deviceBody } from "./contract";
import { SupportError } from "./http";
import { realtimeConnection } from "./realtime";

// The agent's own settings in the support app: availability (online, away, offline: who gets alerts; other agents see
// it live through Presence on staff:presence), the devices that get push alerts, and how to join the private topics.

const MAX_DEVICES = 10;

export async function setAvailability(agent: AgentSession, availability: AgentSession["availability"]): Promise<AgentMe> {
  await prisma.supportAgent.update({ where: { id: agent.id }, data: { availability } });
  return agentMe({ ...agent, availability });
}

export async function saveDevice(agent: AgentSession, input: z.infer<typeof deviceBody>): Promise<{ id: string }> {
  if (input.kind === "webpush" && !allowedEndpoint(input.endpoint)) throw new SupportError(400, "invalid_endpoint", "This browser's push address is not accepted.");
  const row = await prisma.supportDevice.upsert({
    where: { endpoint: input.endpoint },
    create: { agentId: agent.id, kind: input.kind, endpoint: input.endpoint, keys: input.keys, label: input.label?.trim() || null },
    update: { agentId: agent.id, kind: input.kind, keys: input.keys, label: input.label?.trim() || null },
    select: { id: true },
  });
  // At most 10 devices per agent: the oldest go.
  const extra = await prisma.supportDevice.findMany({ where: { agentId: agent.id }, orderBy: { createdAt: "desc" }, skip: MAX_DEVICES, select: { id: true } });
  if (extra.length) await prisma.supportDevice.deleteMany({ where: { id: { in: extra.map((d) => d.id) } } });
  return row;
}

export async function removeDevice(agent: AgentSession, id: string) {
  await prisma.supportDevice.deleteMany({ where: { id, agentId: agent.id } });
}

/** GET /agent/realtime: the connection and the topics this agent may join (the RLS policies check the same). */
export function realtimeFor(agent: AgentSession) {
  const conn = realtimeConnection();
  if (!conn) throw new SupportError(503, "realtime_unavailable", "Live updates are not set up. The app refreshes every few seconds instead.");
  return { ...conn, topics: [STAFF_TOPICS.inbox, STAFF_TOPICS.visitors, STAFF_TOPICS.presence, agentTopic(agent.id)] };
}
