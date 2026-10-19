import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { hasFeature } from "@/lib/entitlements";
import { consumeUsage, refundUsage, UsageLimitError } from "@/lib/usage";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
import { notifyNewLead } from "@/lib/leads/notify";
import { scheduleJob } from "@/lib/jobs/due";
import { channelAdapter } from "@/lib/inbox/channels";
import "@/lib/inbox/all-channels";
import { sendToConversation } from "@/lib/inbox/send";
import { notifyTeam } from "@/lib/inbox/notify";
import type { InboundEvent, OutboundMessage } from "@/lib/inbox/types";
import { addTag, contactSnapshot, removeTag, saveDetails, setField } from "@/lib/contacts/core";
import { exitsOf, nextNodeId, readGraph, triggerOf, type Channel, type Graph, type GraphNode, type NodeOf, type TriggerData } from "./graph";
import { buttonFor, conditionHolds, hasKeyword, messageForChannel, pickAutomation, renderText, triggerScore, validateAnswer, type TriggerInput } from "./match";
import { generateGoalReply, loadBusinessFacts } from "./ai";

// The automation engine (docs/AUTOMATIONS.md). For every inbound message, comment or Story mention it decides:
//   1. a teammate took over the conversation -> nothing (the inbox shows it);
//   2. a run of this contact is waiting (for an answer, a button, the first DM after a comment) -> that run goes on;
//   3. a live automation's trigger matches -> a new run starts;
//   4. otherwise -> not handled (the website chat then answers with its own AI).
// A run walks the live graph step by step until it has to wait (a question, buttons, a delay, an AI turn) or ends.

/** Steps run in one go before the engine stops (a guard against a graph that loops back on itself). */
export const MAX_STEPS_PER_PASS = 25;
/** Wrong answers to a question before it gives up and follows "No answer" (or ends). */
export const MAX_RETRIES = 2;

export type RunContext = {
  channel: Channel;
  trigger: { kind: TriggerData["kind"]; keyword?: string; commentId?: string; postId?: string };
  /** After a private reply to a comment Meta allows nothing more until the person answers: the run waits here. */
  awaitingDmOpen?: boolean;
  retries?: number;
  aiTurns?: number;
  /** Button titles of the message the run waits at, numbered for channels without buttons. */
  buttons?: { id: string; title: string }[];
  lastText?: string;
};

export type DispatchResult = { handled: boolean; paused?: boolean; replies: OutboundMessage[] };

type Pass = { replies: OutboundMessage[] };
type RunRow = { id: string; businessId: string; automationId: string; contactId: string; conversationId: string | null; nodeId: string | null; context: RunContext; graph: Graph };

const asContext = (value: Prisma.JsonValue | null | undefined): RunContext => (value && typeof value === "object" && !Array.isArray(value) ? (value as unknown as RunContext) : ({ channel: "WEBSITE", trigger: { kind: "keyword" } } as RunContext));

/** The live automations of a business with their trigger, newest change first. */
export async function liveAutomations(businessId: string) {
  const rows = await prisma.automation.findMany({
    where: { businessId, status: "LIVE" },
    select: { id: true, version: true, liveGraph: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return rows.flatMap((r) => {
    const graph = readGraph(r.liveGraph);
    const trigger = graph && triggerOf(graph);
    return graph && trigger ? [{ id: r.id, version: r.version, graph, trigger: trigger.data, updatedAt: r.updatedAt }] : [];
  });
}

async function loadRun(runId: string): Promise<RunRow | null> {
  const run = await prisma.automationRun.findUnique({
    where: { id: runId },
    select: { id: true, businessId: true, automationId: true, contactId: true, conversationId: true, nodeId: true, context: true, automation: { select: { liveGraph: true } } },
  });
  if (!run) return null;
  const graph = readGraph(run.automation.liveGraph);
  if (!graph) return null;
  return { ...run, context: asContext(run.context), graph };
}

async function finish(runId: string, status: "DONE" | "STOPPED" | "FAILED", error?: string) {
  await prisma.automationRun.update({ where: { id: runId }, data: { status, finishedAt: new Date(), waitingFor: null, error: error?.slice(0, 300) ?? null } });
}

async function wait(run: RunRow, nodeId: string, waitingFor: "reply" | "button" | "delay" | "ai" | "dm_open", context: RunContext) {
  await prisma.automationRun.update({ where: { id: run.id }, data: { status: "WAITING", nodeId, waitingFor, context: context as unknown as Prisma.InputJsonValue } });
}

/** Claims a waiting run (two messages at once never resume it twice). */
async function claim(runId: string, nodeId: string | null): Promise<boolean> {
  const { count } = await prisma.automationRun.updateMany({ where: { id: runId, status: "WAITING", nodeId }, data: { status: "RUNNING" } });
  return count === 1;
}

/** Sends one message for a run, as a private reply when the run started from a comment and no DM is open yet. */
async function say(run: RunRow, node: GraphNode, message: OutboundMessage, pass: Pass): Promise<"sent" | "waiting" | "failed"> {
  if (!run.conversationId) return "failed";
  const ctx = run.context;
  if (ctx.awaitingDmOpen) {
    await wait(run, node.id, "dm_open", ctx);
    return "waiting";
  }
  const commentStart = !!ctx.trigger.commentId && ctx.awaitingDmOpen === undefined;
  const result = await sendToConversation(run.conversationId, message, {
    author: "BOT",
    automationRunId: run.id,
    privateReply: commentStart,
    commentExternalId: commentStart ? ctx.trigger.commentId : undefined,
  });
  if (!result.ok) {
    await finish(run.id, "FAILED", result.error);
    return "failed";
  }
  if (commentStart) ctx.awaitingDmOpen = true; // Meta: nothing more until they answer the private reply
  pass.replies.push(message);
  return "sent";
}

async function runActions(run: RunRow, node: NodeOf<"action">) {
  for (const a of node.data.actions) {
    try {
      if (a.kind === "add_tag") await addTag(run.businessId, run.contactId, a.tag);
      else if (a.kind === "remove_tag") await removeTag(run.businessId, run.contactId, a.tag);
      else if (a.kind === "set_field") await setField(run.businessId, run.contactId, a.key, a.value);
      else if (a.kind === "subscribe_email") await prisma.contact.update({ where: { id: run.contactId }, data: { emailOptIn: true, unsubscribedAt: null } });
      else if (a.kind === "unsubscribe") await prisma.contact.update({ where: { id: run.contactId }, data: { emailOptIn: false, unsubscribedAt: new Date() } });
      else if (a.kind === "notify_team" && run.conversationId) {
        const c = await contactSnapshot(run.businessId, run.contactId);
        await notifyTeam(run.businessId, { title: `${c?.name || "Someone"} needs you`, body: a.value || "An automation asked the team to look at this conversation.", conversationId: run.conversationId });
      } else if (a.kind === "save_lead") await saveLeadFromRun(run, a.value);
      else if (a.kind === "webhook") {
        const c = await contactSnapshot(run.businessId, run.contactId);
        await emitWebhookEvent(run.businessId, "automation.action", { automationId: run.automationId, runId: run.id, value: a.value, contact: c ? { id: c.id, name: c.name, email: c.email, phone: c.phone, tags: c.tags, fields: c.fields } : null });
      }
    } catch (error) {
      // One failing action (a deleted field, a full tag list) never stops the run.
      console.error("[automations.action]", a.kind, error instanceof Error ? error.message : error);
    }
  }
}

/** Saves the contact as a lead (once per conversation) and sends the usual new-lead alerts. */
async function saveLeadFromRun(run: RunRow, interest: string) {
  const c = await contactSnapshot(run.businessId, run.contactId);
  if (!c || (!c.email && !c.phone)) return;
  const existing = await prisma.lead.findFirst({ where: { businessId: run.businessId, contactId: run.contactId, createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } }, select: { id: true } });
  if (existing) return;
  const lead = await prisma.lead.create({
    data: { businessId: run.businessId, contactId: run.contactId, name: c.name, email: c.email, phone: c.phone, interest: interest.slice(0, 200) || null, source: run.context.channel.toLowerCase(), message: run.context.lastText?.slice(0, 500) ?? null },
    select: { id: true },
  });
  await notifyNewLead(lead.id).catch(() => {});
}

async function aiTurn(run: RunRow, node: NodeOf<"ai">, pass: Pass): Promise<"waiting" | "done" | "failed"> {
  const business = await prisma.business.findUnique({ where: { id: run.businessId }, select: { userId: true } });
  if (!business || !run.conversationId) return "done";
  let reservation: { periodStart: Date } | null = null;
  try {
    reservation = await consumeUsage(business.userId, "chat");
  } catch (error) {
    if (error instanceof UsageLimitError) return "done"; // no replies left this month: move on without the AI
    throw error;
  }
  const turn = (run.context.aiTurns ?? 0) + 1;
  try {
    const [facts, rows, contact] = await Promise.all([
      loadBusinessFacts(run.businessId),
      prisma.message.findMany({ where: { conversationId: run.conversationId, kind: { in: ["MESSAGE", "COMMENT"] }, status: { not: "FAILED" } }, orderBy: { createdAt: "desc" }, take: 12, select: { direction: true, text: true } }),
      contactSnapshot(run.businessId, run.contactId),
    ]);
    if (!facts) return "done";
    const history = rows.reverse().map((m) => ({ role: m.direction === "INBOUND" ? ("visitor" as const) : ("assistant" as const), content: m.text }));
    const reply = await generateGoalReply({
      businessId: run.businessId,
      userId: business.userId,
      facts,
      goal: node.data.goal,
      context: node.data.context,
      channel: run.context.channel,
      history,
      turn,
      maxTurns: node.data.maxTurns,
      leadCaptured: !!(contact?.email || contact?.phone),
    });
    if (reply.detected.name || reply.detected.email || reply.detected.phone) await saveDetails(run.businessId, run.contactId, reply.detected);
    run.context.aiTurns = turn;
    const sent = await say(run, node, { text: reply.reply }, pass);
    if (sent === "failed") return "failed";
    if (sent === "waiting") return "waiting";
    if (reply.goalReached || turn >= node.data.maxTurns) {
      run.context.aiTurns = 0;
      return "done";
    }
    await wait(run, node.id, "ai", run.context);
    return "waiting";
  } catch (error) {
    if (reservation) await refundUsage(business.userId, "chat", reservation.periodStart).catch(() => {});
    console.error("[automations.ai]", error instanceof Error ? error.message : error);
    run.context.aiTurns = 0;
    return "done";
  }
}

/** Walks the graph from `nodeId` until the run waits or ends. */
export async function advance(run: RunRow, nodeId: string | null, pass: Pass = { replies: [] }): Promise<Pass> {
  let at = nodeId;
  for (let step = 0; step < MAX_STEPS_PER_PASS; step++) {
    if (!at) {
      await finish(run.id, "DONE");
      return pass;
    }
    const node = run.graph.nodes.find((n) => n.id === at);
    if (!node) {
      await finish(run.id, "STOPPED", "The automation changed and this step no longer exists.");
      return pass;
    }
    const contact = await contactSnapshot(run.businessId, run.contactId);
    if (!contact) {
      await finish(run.id, "STOPPED", "The contact was deleted.");
      return pass;
    }
    const business = await prisma.business.findUnique({ where: { id: run.businessId }, select: { name: true } });
    const vars = { name: contact.name, email: contact.email, phone: contact.phone, fields: contact.fields, business: business?.name };
    const adapter = channelAdapter(run.context.channel);
    const canButtons = !!adapter?.capabilities.buttons;

    switch (node.type) {
      case "trigger":
        at = nextNodeId(run.graph, node.id);
        continue;
      case "message": {
        const text = renderText(node.data.text, vars);
        const outcome = await say(run, node, { ...messageForChannel(text, node.data.buttons, canButtons), imageUrl: node.data.imageUrl }, pass);
        if (outcome !== "sent") return pass;
        const tapExits = exitsOf(node).filter((e) => e.handle !== "next" && nextNodeId(run.graph, node.id, e.handle));
        if (tapExits.length) {
          run.context.buttons = node.data.buttons.filter((b) => !b.url).map((b) => ({ id: b.id, title: b.title }));
          await wait(run, node.id, "button", run.context);
          return pass;
        }
        at = nextNodeId(run.graph, node.id);
        continue;
      }
      case "question": {
        const text = renderText(node.data.text, vars);
        const outcome = await say(run, node, { text, quickReplies: node.data.quickReplies.length ? node.data.quickReplies : undefined }, pass);
        if (outcome !== "sent") return pass;
        run.context.retries = 0;
        await wait(run, node.id, "reply", run.context);
        if (node.data.timeoutMinutes > 0) {
          await scheduleJob({ kind: "automation.timeout", runAt: new Date(Date.now() + node.data.timeoutMinutes * 60_000), businessId: run.businessId, payload: { runId: run.id, nodeId: node.id }, dedupeKey: `timeout:${run.id}` });
        }
        return pass;
      }
      case "ai": {
        const outcome = await aiTurn(run, node, pass);
        if (outcome !== "done") return pass;
        at = nextNodeId(run.graph, node.id, "done");
        continue;
      }
      case "condition": {
        const holds = conditionHolds(node.data.rules, node.data.mode, { tags: contact.tags, fields: contact.fields, email: contact.email, phone: contact.phone, channel: run.context.channel, lastText: run.context.lastText ?? "" });
        at = nextNodeId(run.graph, node.id, holds ? "yes" : "no");
        continue;
      }
      case "action":
        await runActions(run, node);
        at = nextNodeId(run.graph, node.id);
        continue;
      case "wait":
        await wait(run, node.id, "delay", run.context);
        await scheduleJob({ kind: "automation.resume", runAt: new Date(Date.now() + node.data.minutes * 60_000), businessId: run.businessId, payload: { runId: run.id, nodeId: node.id }, dedupeKey: `resume:${run.id}` });
        return pass;
      case "handover": {
        if (node.data.text.trim()) {
          const outcome = await say(run, node, { text: renderText(node.data.text, vars) }, pass);
          if (outcome === "failed") return pass;
        }
        if (run.conversationId) {
          const until = new Date(Date.now() + node.data.pauseHours * 3_600_000);
          await prisma.conversation.update({ where: { id: run.conversationId }, data: { botPausedUntil: until, status: "OPEN" } });
          await prisma.message.create({ data: { businessId: run.businessId, conversationId: run.conversationId, direction: "OUTBOUND", author: "SYSTEM", kind: "NOTE", text: node.data.note || "An automation handed this conversation to the team.", status: "SENT", automationRunId: run.id } });
          await notifyTeam(run.businessId, { title: `${contact.name || "Someone"} is waiting for your team`, body: node.data.note || "An automation handed this conversation to you. Automations stay quiet until you answer or resume them.", conversationId: run.conversationId });
        }
        await finish(run.id, "DONE");
        return pass;
      }
      case "end":
        await finish(run.id, "DONE");
        return pass;
    }
  }
  await finish(run.id, "STOPPED", "Too many steps in a row: check the automation does not loop back on itself.");
  return pass;
}

/** Starts a new run of `automation` for this inbound message. */
async function startRun(automation: Awaited<ReturnType<typeof liveAutomations>>[number], ctx: { event: InboundEvent; contactId: string; conversationId: string }, pass: Pass): Promise<Pass> {
  // A new run replaces this contact's older runs of the same automation.
  await prisma.automationRun.updateMany({ where: { automationId: automation.id, contactId: ctx.contactId, status: { in: ["RUNNING", "WAITING"] } }, data: { status: "STOPPED", finishedAt: new Date(), waitingFor: null } });
  const t = automation.trigger;
  const keyword = t.keywords.find((k) => hasKeyword(ctx.event.text, k, t.match));
  const context: RunContext = {
    channel: ctx.event.channel as Channel,
    trigger: { kind: t.kind, keyword, ...(ctx.event.kind === "COMMENT" ? { commentId: ctx.event.externalMessageId, postId: ctx.event.postExternalId } : {}) },
    lastText: ctx.event.text,
  };
  const created = await prisma.automationRun.create({
    data: { businessId: ctx.event.businessId, automationId: automation.id, version: automation.version, contactId: ctx.contactId, conversationId: ctx.conversationId, status: "RUNNING", context: context as unknown as Prisma.InputJsonValue },
    select: { id: true },
  });
  const run: RunRow = { id: created.id, businessId: ctx.event.businessId, automationId: automation.id, contactId: ctx.contactId, conversationId: ctx.conversationId, nodeId: null, context, graph: automation.graph };
  // Comment triggers: the public answer under the comment first ("Sent you a DM!").
  if (ctx.event.kind === "COMMENT" && t.publicReplies.length && ctx.event.externalMessageId) {
    const text = t.publicReplies[Math.floor(Math.random() * t.publicReplies.length)];
    await sendToConversation(ctx.conversationId, { text }, { author: "BOT", automationRunId: run.id, kind: "COMMENT_REPLY", commentExternalId: ctx.event.externalMessageId });
  }
  const trigger = triggerOf(automation.graph)!;
  return advance(run, nextNodeId(automation.graph, trigger.id), pass);
}

/** A waiting run receives the person's message. Returns false when the message is not for it (it then starts afresh). */
async function resume(runId: string, event: InboundEvent, conversationId: string, pass: Pass): Promise<boolean> {
  const run = await loadRun(runId);
  if (!run || !run.nodeId) return false;
  const waitingFor = (await prisma.automationRun.findUnique({ where: { id: runId }, select: { waitingFor: true } }))?.waitingFor;
  const node = run.graph.nodes.find((n) => n.id === run.nodeId);
  if (!node || waitingFor === "delay") return false;
  if (!(await claim(run.id, run.nodeId))) return true; // another message is resuming it right now
  run.context.lastText = event.text;
  // A comment-started run moves to the DM conversation once the person writes there.
  if (event.kind === "MESSAGE" && run.conversationId !== conversationId) {
    run.conversationId = conversationId;
    await prisma.automationRun.update({ where: { id: run.id }, data: { conversationId } });
  }
  if (waitingFor === "dm_open") {
    run.context.awaitingDmOpen = false;
    await advance(run, node.id, pass); // send the step that was waiting for the door to open
    return true;
  }
  if (waitingFor === "button" && node.type === "message") {
    const chosen = buttonFor({ text: event.text, buttonId: event.buttonId }, run.context.buttons ?? []);
    const target = chosen ? nextNodeId(run.graph, node.id, chosen) : nextNodeId(run.graph, node.id);
    if (!target) {
      await finish(run.id, "DONE");
      return false;
    }
    await advance(run, target, pass);
    return true;
  }
  if (waitingFor === "reply" && node.type === "question") {
    const value = validateAnswer(event.text, node.data.validate);
    if (value === null) {
      const retries = (run.context.retries ?? 0) + 1;
      if (retries > MAX_RETRIES) {
        await advance(run, nextNodeId(run.graph, node.id, "no_answer"), pass);
        return true;
      }
      run.context.retries = retries;
      const outcome = await say(run, node, { text: node.data.retryText.trim() || "Sorry, I did not get that. Could you try again?" }, pass);
      if (outcome === "sent") await wait(run, node.id, "reply", run.context);
      return true;
    }
    if (node.data.saveTo === "field" && node.data.fieldKey) await setField(run.businessId, run.contactId, node.data.fieldKey, value).catch(() => {});
    else if (node.data.saveTo !== "field") await saveDetails(run.businessId, run.contactId, { [node.data.saveTo]: value });
    await advance(run, nextNodeId(run.graph, node.id, "answered"), pass);
    return true;
  }
  if (waitingFor === "ai" && node.type === "ai") {
    const outcome = await aiTurn(run, node, pass);
    if (outcome === "done") await advance(run, nextNodeId(run.graph, node.id, "done"), pass);
    return true;
  }
  await finish(run.id, "STOPPED", "The run was waiting at a step that changed.");
  return false;
}

/** Called for every new inbound item (lib/automations/dispatch.ts). */
export async function handleInbound(input: { event: InboundEvent; contactId: string; conversationId: string; botPaused: boolean }): Promise<DispatchResult> {
  const pass: Pass = { replies: [] };
  if (input.botPaused) return { handled: true, paused: true, replies: [] };
  if (!(await hasFeature(input.event.businessId, "automations"))) return { handled: false, replies: [] };

  const live = await liveAutomations(input.event.businessId);
  const firstMessage = (await prisma.message.count({ where: { conversationId: input.conversationId, direction: "INBOUND" } })) <= 1;
  const triggerInput: TriggerInput = { channel: input.event.channel as Channel, kind: input.event.kind, text: input.event.text, postExternalId: input.event.postExternalId, firstMessage };

  // A keyword the person typed on purpose beats an older conversation that waits for an answer.
  const strong = pickAutomation(live, triggerInput);
  const strongScore = strong ? triggerScore(strong.trigger, triggerInput) : 0;

  if (input.event.kind !== "COMMENT" && strongScore < 50) {
    const waiting = await prisma.automationRun.findFirst({
      where: { businessId: input.event.businessId, contactId: input.contactId, status: "WAITING", waitingFor: { in: ["reply", "button", "ai", "dm_open"] }, context: { path: ["channel"], equals: input.event.channel } },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (waiting && (await resume(waiting.id, input.event, input.conversationId, pass))) return { handled: true, replies: pass.replies };
  }
  if (!strong) return { handled: false, replies: [] };
  await startRun(strong, input, pass);
  return { handled: true, replies: pass.replies };
}

/** Job: a "Wait" step is over. */
export async function resumeAfterDelay(payload: { runId?: string; nodeId?: string }): Promise<void> {
  if (!payload.runId || !payload.nodeId) return;
  const run = await loadRun(payload.runId);
  if (!run || run.nodeId !== payload.nodeId) return;
  if (!(await claim(run.id, payload.nodeId))) return;
  await advance(run, nextNodeId(run.graph, payload.nodeId));
}

/** Job: nobody answered a question in time. */
export async function questionTimedOut(payload: { runId?: string; nodeId?: string }): Promise<void> {
  if (!payload.runId || !payload.nodeId) return;
  const run = await loadRun(payload.runId);
  if (!run || run.nodeId !== payload.nodeId) return;
  const state = await prisma.automationRun.findUnique({ where: { id: run.id }, select: { waitingFor: true } });
  if (state?.waitingFor !== "reply") return;
  if (!(await claim(run.id, payload.nodeId))) return;
  const target = nextNodeId(run.graph, payload.nodeId, "no_answer");
  if (target) await advance(run, target);
  else await finish(run.id, "DONE");
}
