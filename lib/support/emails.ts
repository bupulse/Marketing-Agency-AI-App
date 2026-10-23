import "server-only";
import { prisma } from "@/lib/db";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { scheduleJob } from "@/lib/jobs/due";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { getSupportSettings, teamHours } from "./settings";

// Emails to the visitor (never to anyone else): the transcript they asked for after rating, the outside-hours ticket
// ("we got your message, the team replies when it is back"), and an agent's reply they have not seen in the chat.
// Each goes through a DueJob (jobs.ts), so a mail problem retries and never slows the chat.

export const JOB_TRANSCRIPT = "support.transcript";
export const JOB_REPLY_EMAIL = "support.reply_email";

/** Where the emails send people back to: the site with the chat opened (the widget opens on ?help=open). */
export const chatReturnUrl = () => `${publicSiteUrl()}/?help=open`;

const AUTHOR = { VISITOR: "You", AI: "BuPulse assistant", AGENT: "BuPulse team", SYSTEM: "BuPulse" } as const;

export async function scheduleTranscript(conversationId: string) {
  await scheduleJob({ kind: JOB_TRANSCRIPT, runAt: new Date(), payload: { conversationId }, dedupeKey: `${JOB_TRANSCRIPT}:${conversationId}` });
}

/** The chat as plain lines (no internal notes or events), oldest first. */
async function transcriptLines(conversationId: string, take = 200) {
  const rows = await prisma.supportMessage.findMany({ where: { conversationId, kind: { notIn: ["NOTE", "EVENT"] } }, orderBy: { createdAt: "asc" }, take, select: { author: true, body: true, createdAt: true, agent: { select: { name: true } } } });
  return rows.map((m) => ({ label: `${m.author === "AGENT" && m.agent ? m.agent.name.split(/\s+/)[0] : AUTHOR[m.author]} · ${m.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC`, value: m.body }));
}

/** Sends the transcript once (transcriptSentAt). True when sent or nothing to do. */
export async function sendTranscriptEmail(conversationId: string): Promise<boolean> {
  const c = await prisma.supportConversation.findUnique({ where: { id: conversationId }, select: { number: true, transcriptSentAt: true, visitor: { select: { email: true, name: true } } } });
  if (!c || c.transcriptSentAt || !c.visitor.email) return true;
  const { html, text } = renderEmail({
    heading: `Your chat with BuPulse (#${c.number})`,
    intro: `${c.visitor.name ? `Hi ${c.visitor.name}, h` : "H"}ere is a copy of your chat with BuPulse support.`,
    blocks: await transcriptLines(conversationId),
    button: { label: "Chat with us again", url: chatReturnUrl() },
    footer: "You asked for this copy at the end of the chat.",
  });
  const sent = await sendEmail({ to: c.visitor.email, subject: `Your chat with BuPulse (#${c.number})`, html, text });
  if (sent) await prisma.supportConversation.update({ where: { id: conversationId }, data: { transcriptSentAt: new Date() } });
  return sent;
}

/** The outside-hours ticket email, once per hand-over (ticketSentAt). */
export async function sendTicketEmail(conversationId: string): Promise<boolean> {
  const c = await prisma.supportConversation.findUnique({ where: { id: conversationId }, select: { number: true, status: true, ticketSentAt: true, visitor: { select: { email: true, name: true } } } });
  if (!c || c.status !== "PENDING" || c.ticketSentAt || !c.visitor.email) return true;
  const settings = await getSupportSettings();
  const hours = teamHours(settings);
  const { html, text } = renderEmail({
    heading: "We got your message",
    intro: `${c.visitor.name ? `Hi ${c.visitor.name}, o` : "O"}ur team is away right now (${hours.label}). Your chat #${c.number} is waiting for them, and they will reply by email${settings.whatsapp ? " or WhatsApp" : ""} when they are back.`,
    button: { label: "Open the chat", url: chatReturnUrl() },
    footer: "You can reply to the chat any time; your messages reach the team.",
  });
  const sent = await sendEmail({ to: c.visitor.email, subject: `We got your message (chat #${c.number})`, html, text });
  if (sent) await prisma.supportConversation.update({ where: { id: conversationId }, data: { ticketSentAt: new Date() } });
  return sent;
}

/** Agent replies the visitor has not seen in the chat, by email (the "we will reply by email" promise). */
export async function sendReplyEmail(conversationId: string): Promise<boolean> {
  const c = await prisma.supportConversation.findUnique({ where: { id: conversationId }, select: { number: true, visitor: { select: { email: true, name: true } } } });
  if (!c?.visitor.email) return true;
  const unseen = await prisma.supportMessage.findMany({ where: { conversationId, author: "AGENT", kind: { in: ["TEXT", "FILE"] }, seenByVisitorAt: null }, orderBy: { createdAt: "asc" }, take: 10, select: { id: true, body: true, agent: { select: { name: true } } } });
  if (!unseen.length) return true;
  const { html, text } = renderEmail({
    heading: `A reply to your chat #${c.number}`,
    intro: `${c.visitor.name ? `Hi ${c.visitor.name}, t` : "T"}he BuPulse team replied while you were away:`,
    blocks: unseen.map((m) => ({ label: m.agent?.name.split(/\s+/)[0] ?? "BuPulse team", value: m.body })),
    button: { label: "Reply in the chat", url: chatReturnUrl() },
  });
  const sent = await sendEmail({ to: c.visitor.email, subject: `A reply to your chat #${c.number}`, html, text });
  // Seen by email: the next email only carries newer replies (the chat still shows them all).
  if (sent) await prisma.supportMessage.updateMany({ where: { id: { in: unseen.map((m) => m.id) } }, data: { seenByVisitorAt: new Date() } });
  return sent;
}
