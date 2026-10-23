import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { ConversationStatus, ConversationView, MessageView } from "./contract";
import { signedDownloadUrls } from "./storage";
import { topicSecret } from "./tokens";
import { visitorTopic } from "./contract";

// Database rows -> the contract's shapes. Visitors never see internal notes; attachment links are short-lived signed
// URLs made in one batch per answer.

export const messageSelect = {
  id: true,
  author: true,
  kind: true,
  body: true,
  lang: true,
  translations: true,
  aiSources: true,
  aiActions: true,
  clientMsgId: true,
  createdAt: true,
  seenByVisitorAt: true,
  seenByAgentAt: true,
  agent: { select: { name: true } },
  attachment: { select: { id: true, mime: true, fileName: true, bytes: true, storagePath: true, durationSec: true, transcript: true, uploadedAt: true, expiresAt: true } },
} satisfies Prisma.SupportMessageSelect;

export type MessageRow = Prisma.SupportMessageGetPayload<{ select: typeof messageSelect }>;

/** "Jean Mugisha" -> "Jean M.": agents show by first name and initial. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "BuPulse team";
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

type Source = { title: string; href: string | null };
type Action = { label: string; href: string };

function sourcesOf(value: Prisma.JsonValue | null): Source[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  return value.flatMap((v) => (v && typeof v === "object" && !Array.isArray(v) && typeof v.title === "string" ? [{ title: v.title, href: typeof v.href === "string" ? v.href : null }] : []));
}

function actionsOf(value: Prisma.JsonValue | null): Action[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  return value.flatMap((v) => (v && typeof v === "object" && !Array.isArray(v) && typeof v.label === "string" && typeof v.href === "string" ? [{ label: v.label, href: v.href }] : []));
}

/** The original text of a translated agent message (translations.original), for agents only. */
export function originalOf(m: Pick<MessageRow, "translations">): string | null {
  const t = m.translations;
  return t && typeof t === "object" && !Array.isArray(t) && typeof t.original === "string" ? t.original : null;
}

export async function toMessageViews(rows: MessageRow[], now = new Date()): Promise<MessageView[]> {
  const live = rows.flatMap((r) => (r.attachment?.uploadedAt && r.attachment.expiresAt > now ? [r.attachment.storagePath] : []));
  const urls = await signedDownloadUrls(live);
  return rows.map((m) => ({
    id: m.id,
    author: m.author,
    kind: m.kind,
    body: m.body,
    agentName: m.author === "AGENT" && m.agent ? shortName(m.agent.name) : null,
    sources: sourcesOf(m.aiSources),
    actions: actionsOf(m.aiActions),
    attachment: m.attachment
      ? { id: m.attachment.id, mime: m.attachment.mime, fileName: m.attachment.fileName, bytes: m.attachment.bytes, url: urls.get(m.attachment.storagePath) ?? null, durationSec: m.attachment.durationSec, transcript: m.attachment.transcript }
      : null,
    createdAt: m.createdAt.toISOString(),
    clientMsgId: m.clientMsgId,
  }));
}

export type ConversationRow = {
  id: string;
  number: number;
  status: ConversationStatus;
  aiActive: boolean;
  rating: number | null;
  assignee: { name: string } | null;
  department: { name: string } | null;
};

export const conversationSelect = {
  id: true,
  number: true,
  status: true,
  aiActive: true,
  rating: true,
  assignee: { select: { name: true } },
  department: { select: { name: true } },
} satisfies Prisma.SupportConversationSelect;

export function agentOf(c: Pick<ConversationRow, "assignee" | "department">) {
  return c.assignee ? { name: shortName(c.assignee.name), department: c.department?.name ?? null } : null;
}

/** The visitor's view: their own conversation, its topic secret, and its messages without internal notes. */
export async function toConversationView(c: ConversationRow, messages: MessageRow[]): Promise<ConversationView> {
  return {
    id: c.id,
    number: c.number,
    status: c.status,
    aiActive: c.aiActive,
    agent: agentOf(c),
    topic: visitorTopic(await topicSecret(c.id)),
    rating: c.rating,
    messages: await toMessageViews(messages.filter((m) => m.kind !== "NOTE")),
  };
}
