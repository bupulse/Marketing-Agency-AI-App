// The Lab's posting habits for the planners: the "schedule" examples switched on for the schedule engine, merged by
// network (schedule.ts). An empty Lab, or a database that cannot be read, gives empty maps, so planning is unchanged.
import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { labHoursByNetwork, type LabSchedule } from "./schedule";

const ROWS = 100;

export async function labSchedule(opts: { country?: string | null } = {}): Promise<LabSchedule> {
  try {
    const rows = await prisma.trainingExample.findMany({ where: { kind: "schedule", engines: { has: "schedule" } }, orderBy: { createdAt: "desc" }, take: ROWS, select: { id: true, rating: true, notes: true, createdAt: true } });
    return labHoursByNetwork(rows, opts);
  } catch (error) {
    await logError(error, { source: "training-lab.schedule", level: "warn" });
    return labHoursByNetwork([]);
  }
}
