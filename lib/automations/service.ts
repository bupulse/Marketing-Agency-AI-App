import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { emptyGraph, graphProblems, graphSchema, readGraph, triggerOf, type Graph, type GraphProblem } from "./graph";
import { templateByKey } from "./templates";

// The Automations pages (app/dashboard/automations): list, create (blank or from a template), save the draft drawn on
// the canvas, publish it (checked first), pause, duplicate and delete. Publishing copies the draft into `liveGraph`, so
// editing never changes what runs until the next publish. docs/AUTOMATIONS.md.

export const MAX_AUTOMATIONS = 100;

export class AutomationError extends Error {
  constructor(
    readonly code: "not_found" | "invalid" | "limit",
    message: string,
    readonly problems: GraphProblem[] = [],
  ) {
    super(message);
    this.name = "AutomationError";
  }
}

const json = (g: Graph) => g as unknown as Prisma.InputJsonValue;

export async function listAutomations(businessId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [rows, stats] = await Promise.all([
    prisma.automation.findMany({
      where: { businessId },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      select: { id: true, name: true, status: true, triggerType: true, channels: true, graph: true, updatedAt: true, publishedAt: true, liveGraph: true },
    }),
    prisma.automationRun.groupBy({ by: ["automationId", "status"], where: { businessId, startedAt: { gte: since } }, _count: { _all: true } }),
  ]);
  return rows.map((r) => {
    const own = stats.filter((s) => s.automationId === r.id);
    const count = (status?: string) => own.filter((s) => !status || s.status === status).reduce((n, s) => n + s._count._all, 0);
    const draft = readGraph(r.graph);
    const trigger = draft ? triggerOf(draft) : null;
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      trigger: trigger?.data.kind ?? null,
      keywords: trigger?.data.keywords ?? [],
      channels: trigger?.data.channels ?? r.channels,
      updatedAt: r.updatedAt.toISOString(),
      /** The draft differs from what is live: "Unpublished changes". */
      changed: r.status !== "DRAFT" && JSON.stringify(r.graph) !== JSON.stringify(r.liveGraph),
      runs: { started: count(), finished: count("DONE"), waiting: count("WAITING"), failed: count("FAILED") },
    };
  });
}
export type AutomationRow = Awaited<ReturnType<typeof listAutomations>>[number];

/** Creates a draft from a template, or a blank one with just a trigger. */
export async function createAutomation(businessId: string, actorId: string, templateKey: string | null): Promise<string> {
  const count = await prisma.automation.count({ where: { businessId } });
  if (count >= MAX_AUTOMATIONS) throw new AutomationError("limit", `You can have up to ${MAX_AUTOMATIONS} automations. Delete one you no longer use.`);
  const template = templateKey ? templateByKey(templateKey) : null;
  if (templateKey && !template) throw new AutomationError("not_found", "That template no longer exists.");
  const graph = template ? template.graph() : emptyGraph();
  // Template steps that save to a custom field need the field: create it so the automation can be published as is.
  for (const n of graph.nodes) {
    if (n.type === "question" && n.data.saveTo === "field" && n.data.fieldKey) {
      const key = n.data.fieldKey;
      await prisma.contactField.upsert({ where: { businessId_key: { businessId, key } }, create: { businessId, key, label: key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) }, update: {} });
    }
  }
  const row = await prisma.automation.create({
    data: { businessId, name: template?.name ?? "New automation", graph: json(graph), templateKey: template?.key ?? null, createdById: actorId },
    select: { id: true },
  });
  return row.id;
}

export async function getAutomation(businessId: string, id: string) {
  const r = await prisma.automation.findFirst({ where: { id, businessId }, select: { id: true, name: true, status: true, graph: true, liveGraph: true, version: true, publishedAt: true, updatedAt: true } });
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    graph: readGraph(r.graph) ?? emptyGraph(),
    changed: r.status !== "DRAFT" && JSON.stringify(r.graph) !== JSON.stringify(r.liveGraph),
    version: r.version,
    publishedAt: r.publishedAt?.toISOString() ?? null,
  };
}

async function own(businessId: string, id: string) {
  const r = await prisma.automation.findFirst({ where: { id, businessId }, select: { id: true, status: true, graph: true } });
  if (!r) throw new AutomationError("not_found", "That automation no longer exists.");
  return r;
}

/** Saves the canvas (the draft). A live automation keeps running its published copy until it is published again. */
export async function saveDraft(businessId: string, id: string, input: { name: string; graph: unknown }): Promise<void> {
  await own(businessId, id);
  const parsed = graphSchema.safeParse(input.graph);
  if (!parsed.success) throw new AutomationError("invalid", "Some steps have settings that are not valid. Check the highlighted steps.");
  const name = input.name.trim().slice(0, 80) || "Untitled automation";
  await prisma.automation.update({ where: { id }, data: { name, graph: json(parsed.data) } });
}

/** Checks and publishes the draft. Refuses with the list of problems when it is not complete. */
export async function publish(businessId: string, id: string): Promise<void> {
  const row = await own(businessId, id);
  const graph = readGraph(row.graph);
  if (!graph) throw new AutomationError("invalid", "Some steps have settings that are not valid.");
  const problems = graphProblems(graph);
  // Fields saved by questions must exist.
  const keys = graph.nodes.flatMap((n) => (n.type === "question" && n.data.saveTo === "field" && n.data.fieldKey ? [n.data.fieldKey] : n.type === "action" ? n.data.actions.filter((a) => a.kind === "set_field").map((a) => a.key) : []));
  if (keys.length) {
    const known = new Set((await prisma.contactField.findMany({ where: { businessId, key: { in: keys } }, select: { key: true } })).map((f) => f.key));
    for (const k of keys) if (!known.has(k)) problems.push({ message: `The contact field "${k}" no longer exists. Choose another one.` });
  }
  if (problems.length) throw new AutomationError("invalid", "This automation is not ready yet.", problems);
  const trigger = triggerOf(graph)!;
  await prisma.automation.update({
    where: { id },
    data: { status: "LIVE", liveGraph: json(graph), version: { increment: 1 }, triggerType: trigger.data.kind, channels: trigger.data.channels, publishedAt: new Date() },
  });
}

/** Pauses (new people are not started; runs already going are stopped) or resumes a published automation. */
export async function setPaused(businessId: string, id: string, paused: boolean): Promise<void> {
  const row = await prisma.automation.findFirst({ where: { id, businessId }, select: { status: true, liveGraph: true } });
  if (!row) throw new AutomationError("not_found", "That automation no longer exists.");
  if (!paused && !row.liveGraph) throw new AutomationError("invalid", "Publish it first.");
  await prisma.automation.update({ where: { id }, data: { status: paused ? "PAUSED" : "LIVE" } });
  if (paused) await prisma.automationRun.updateMany({ where: { automationId: id, status: { in: ["RUNNING", "WAITING"] } }, data: { status: "STOPPED", finishedAt: new Date(), waitingFor: null, error: "The automation was paused." } });
}

export async function duplicate(businessId: string, actorId: string, id: string): Promise<string> {
  const row = await prisma.automation.findFirst({ where: { id, businessId }, select: { name: true, graph: true } });
  if (!row) throw new AutomationError("not_found", "That automation no longer exists.");
  const count = await prisma.automation.count({ where: { businessId } });
  if (count >= MAX_AUTOMATIONS) throw new AutomationError("limit", `You can have up to ${MAX_AUTOMATIONS} automations.`);
  const copy = await prisma.automation.create({ data: { businessId, name: `${row.name} (copy)`.slice(0, 80), graph: row.graph as Prisma.InputJsonValue, createdById: actorId }, select: { id: true } });
  return copy.id;
}

export async function remove(businessId: string, id: string): Promise<void> {
  await prisma.automation.deleteMany({ where: { id, businessId } });
}

/** Recent runs of one automation, for its page. */
export async function recentRuns(businessId: string, id: string) {
  const runs = await prisma.automationRun.findMany({
    where: { businessId, automationId: id },
    orderBy: { startedAt: "desc" },
    take: 20,
    select: { id: true, status: true, startedAt: true, error: true, contact: { select: { id: true, name: true } } },
  });
  return runs.map((r) => ({ id: r.id, status: r.status, startedAt: r.startedAt.toISOString(), error: r.error, contact: { id: r.contact.id, name: r.contact.name || "Someone" } }));
}
