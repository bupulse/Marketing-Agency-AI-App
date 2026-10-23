import "server-only";
import type { z } from "zod";
import { prisma } from "@/lib/db";
import { scheduleSweep } from "./jobs";
import { geoFrom, deviceFrom, referrerHost, requestIp } from "./client-info";
import type { Surface, VisitResponse, visitBody } from "./contract";
import { signedInPerson, type SignedInPerson } from "./identity";
import { SupportError, limit } from "./http";
import { GREETING_QUIET_MS, RESUME_WINDOW_MS, SUPPORT_LIMITS, VIEW_MESSAGES, VISIT_IDLE_MS } from "./limits";
import { broadcast, realtimeConnection } from "./realtime";
import { getSupportSettings, greetingFor, teamHours } from "./settings";
import { randomToken, sha256Hex } from "./tokens";
import { conversationSelect, messageSelect, toConversationView } from "./views";

// A visit: one person on the site, from the first page until 20 minutes without a heartbeat. POST /visit starts it (or
// continues it, when the widget sends the token it already has), captures the address, location and device once, and
// tells the widget who the person is, the team hours, the greeting and the chat to resume. After that the page sends
// heartbeats straight to Supabase (support_heartbeat), and the chat routes identify the visitor by the token.

export const VISIT_HEADER = "x-support-visit";

export type VisitRequest = { headers: Headers; ownHosts: string[]; ipHash: string };

export type VisitorSession = {
  visitId: string;
  visitorId: string;
  surface: Surface;
  country: string | null;
  visitor: { id: string; name: string | null; email: string | null; phone: string | null; businessName: string | null; userId: string | null; businessId: string | null; creatorProfileId: string | null; leadId: string | null };
};

const visitorSelect = { id: true, name: true, email: true, phone: true, businessName: true, userId: true, businessId: true, creatorProfileId: true, leadId: true } as const;

/** The visitor behind an X-Support-Visit token. Any visit of the last week counts (an idle one still owns its chats). */
export async function requireVisit(headers: Headers): Promise<VisitorSession> {
  const token = headers.get(VISIT_HEADER)?.trim();
  if (!token || token.length < 20 || token.length > 100) throw new SupportError(401, "visit_required", "Open the chat again to continue.");
  const visit = await prisma.supportVisit.findUnique({
    where: { tokenHash: await sha256Hex(token) },
    select: { id: true, visitorId: true, surface: true, country: true, startedAt: true, visitor: { select: visitorSelect } },
  });
  if (!visit || Date.now() - visit.startedAt.getTime() > RESUME_WINDOW_MS) throw new SupportError(401, "visit_expired", "This chat session has ended. Reload the page to continue.");
  return { visitId: visit.id, visitorId: visit.visitorId, surface: visit.surface as Surface, country: visit.country, visitor: visit.visitor };
}

/**
 * The visitor row for this browser's key. A row linked to another signed-in account (a shared computer, someone
 * signed out) is never reused: its key is moved aside and a fresh row starts, so nobody sees another person's chats.
 * An anonymous row is claimed by the person who signs in on it.
 */
async function resolveVisitor(visitorKey: string, person: SignedInPerson | null, optOut: boolean) {
  const existing = await prisma.supportVisitor.findUnique({ where: { visitorKey }, select: { id: true, userId: true, optedOut: true } });
  if (existing?.userId && existing.userId !== person?.userId) {
    await prisma.supportVisitor.update({ where: { id: existing.id }, data: { visitorKey: `${visitorKey}:moved:${randomToken(6)}` } });
  }
  const reusable = existing && (!existing.userId || existing.userId === person?.userId) ? existing : null;
  const linked = person
    ? { userId: person.userId, businessId: person.businessId, creatorProfileId: person.creatorProfileId, ...(person.businessName ? { businessName: person.businessName } : {}) }
    : {};
  const now = new Date();
  if (reusable) {
    const current = await prisma.supportVisitor.findUnique({ where: { id: reusable.id }, select: { name: true, email: true } });
    return prisma.supportVisitor.update({
      where: { id: reusable.id },
      data: { ...linked, lastSeenAt: now, ...(optOut ? { optedOut: true } : {}), ...(person && !current?.name && person.name ? { name: person.name } : {}), ...(person && !current?.email && person.email ? { email: person.email } : {}) },
      select: { ...visitorSelect, optedOut: true, visitCount: true },
    });
  }
  return prisma.supportVisitor.create({
    data: { visitorKey, ...linked, name: person?.name ?? null, email: person?.email ?? null, optedOut: optOut, lastSeenAt: now },
    select: { ...visitorSelect, optedOut: true, visitCount: true },
  });
}

/** POST /visit. */
export async function startVisit(body: z.infer<typeof visitBody>, req: VisitRequest): Promise<VisitResponse> {
  await limit(`support:visit:ip:${req.ipHash}`, SUPPORT_LIMITS.visitIp);
  await limit(`support:visit:key:${body.visitorKey}`, SUPPORT_LIMITS.visitVisitor);
  const person = await signedInPerson();
  const visitor = await resolveVisitor(body.visitorKey, person, !!body.optOut);
  const now = new Date();
  const path = body.path.slice(0, 500) || "/";
  const title = body.title?.slice(0, 300) || null;
  const device = deviceFrom(req.headers, body.screenW);

  // Continue the visit the widget already has (another page of the same visit), else start a new one.
  const sent = req.headers.get(VISIT_HEADER)?.trim();
  const current = sent
    ? await prisma.supportVisit.findUnique({ where: { tokenHash: await sha256Hex(sent) }, select: { id: true, visitorId: true, endedAt: true, lastSeenAt: true, currentPath: true, pageCount: true } })
    : null;
  let token: string;
  let visitId: string;
  if (current && current.visitorId === visitor.id && !current.endedAt && now.getTime() - current.lastSeenAt.getTime() < VISIT_IDLE_MS) {
    token = sent!;
    visitId = current.id;
    const changed = current.currentPath !== path;
    await prisma.supportVisit.update({ where: { id: current.id }, data: { lastSeenAt: now, surface: body.surface, ...(changed ? { currentPath: path, currentTitle: title, pageCount: { increment: 1 } } : {}) } });
    if (changed && current.pageCount < 50 && !visitor.optedOut) await prisma.supportPageHit.create({ data: { visitId: current.id, path, title, at: now } });
  } else {
    token = randomToken();
    const geo = geoFrom(req.headers);
    const track = !visitor.optedOut;
    const created = await prisma.supportVisit.create({
      data: {
        visitorId: visitor.id,
        tokenHash: await sha256Hex(token),
        surface: body.surface,
        ip: track ? requestIp(req.headers) : null,
        country: geo.country,
        city: track ? geo.city : null,
        region: track ? geo.region : null,
        timezone: geo.timezone,
        device: device.device,
        os: device.os,
        browser: device.browser,
        referrer: referrerHost(body.referrer, req.ownHosts),
        landingPath: path,
        currentPath: path,
        currentTitle: title,
        pageCount: 1,
        startedAt: now,
        lastSeenAt: now,
        ...(track ? { pages: { create: { path, title, at: now } } } : {}),
      },
      select: { id: true },
    });
    visitId = created.id;
    await prisma.supportVisitor.update({ where: { id: visitor.id }, data: { visitCount: { increment: 1 } } });
  }
  await broadcast({ type: "visitor.changed", visitId }, { visitors: true });
  scheduleSweep();

  const settings = await getSupportSettings();
  const hours = teamHours(settings, now);
  const conversation = await resumable(visitor.id, person?.userId ?? null, now);
  const lastChat = await prisma.supportConversation.findFirst({ where: { visitorId: visitor.id }, orderBy: { lastMessageAt: "desc" }, select: { lastMessageAt: true } });
  const rule = greetingFor(settings, path);
  const quiet = !!lastChat && now.getTime() - lastChat.lastMessageAt.getTime() < GREETING_QUIET_MS;
  const greeting = rule && !conversation && !quiet && !visitor.optedOut && body.surface !== "bio" && device.device !== "phone" ? { text: rule.text, delaySec: rule.delaySec, quickReplies: rule.quickReplies } : null;
  const signedIn = !!person;
  const formFilled = !!(visitor.name && visitor.email && visitor.businessName);
  return {
    visitToken: token,
    me: {
      name: visitor.name,
      email: visitor.email,
      signedIn,
      businessName: visitor.businessName,
      needsForm: !signedIn && (body.surface === "public" || body.surface === "bio") && !formFilled,
    },
    hours,
    greeting,
    conversation,
    realtime: realtimeConnection(),
  };
}

/** The open chat to show again: this visitor's, or (signed in) any of this person's from another browser. */
async function resumable(visitorId: string, userId: string | null, now: Date) {
  const row = await prisma.supportConversation.findFirst({
    where: { status: { not: "CLOSED" }, lastMessageAt: { gt: new Date(now.getTime() - RESUME_WINDOW_MS) }, OR: [{ visitorId }, ...(userId ? [{ visitor: { userId } }] : [])] },
    orderBy: { lastMessageAt: "desc" },
    select: conversationSelect,
  });
  if (!row) return null;
  const messages = await prisma.supportMessage.findMany({ where: { conversationId: row.id, kind: { not: "NOTE" } }, orderBy: { createdAt: "desc" }, take: VIEW_MESSAGES, select: messageSelect });
  return toConversationView(row, messages.reverse());
}
