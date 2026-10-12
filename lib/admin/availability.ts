import "server-only";
import { prisma } from "@/lib/db";
import { cleanWindows, minutesToHm, parseHm, WEEKDAY_NAMES, type AvailabilityWindow } from "@/lib/demo/slots";
import { writeAudit } from "./audit";
import { AdminError, type AdminContext } from "./types";

// The owner's weekly demo windows (AdminAvailability), edited in Admin -> Settings. Audited on setting:demo.availability.

export async function listAvailability() {
  const rows = await prisma.adminAvailability.findMany({ orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] });
  return rows.map((r) => ({ id: r.id, weekday: r.weekday, weekdayName: WEEKDAY_NAMES[r.weekday] ?? String(r.weekday), start: minutesToHm(r.startMinute), end: minutesToHm(r.endMinute), startMinute: r.startMinute, endMinute: r.endMinute }));
}

/** Adds a window ("09:00" to "17:00" on a weekday). Windows on the same day must not overlap. */
export async function addAvailability(ctx: AdminContext, input: { weekday: number; start: string; end: string }): Promise<AvailabilityWindow & { id: string }> {
  const startMinute = parseHm(String(input.start ?? ""));
  const endMinute = parseHm(String(input.end ?? ""));
  if (startMinute === null || endMinute === null) throw new AdminError("invalid", "Enter times as HH:MM, for example 09:00.");
  let window: AvailabilityWindow;
  try {
    [window] = cleanWindows([{ weekday: input.weekday, startMinute, endMinute }]);
  } catch (e) {
    throw new AdminError("invalid", e instanceof Error ? e.message : "That window is not valid.");
  }
  const clash = (await prisma.adminAvailability.findMany({ where: { weekday: window.weekday } })).find((r) => r.startMinute < window.endMinute && r.endMinute > window.startMinute);
  if (clash) throw new AdminError("conflict", `That overlaps ${WEEKDAY_NAMES[window.weekday]} ${minutesToHm(clash.startMinute)}-${minutesToHm(clash.endMinute)}. Remove it first.`);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.adminAvailability.create({ data: window });
    await writeAudit(tx, ctx, "update_availability", "setting:demo.availability", null, { added: { ...window, id: created.id } });
    return created;
  });
  return { id: row.id, ...window };
}

export async function removeAvailability(ctx: AdminContext, id: string) {
  const row = await prisma.adminAvailability.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "No such window.");
  await prisma.$transaction(async (tx) => {
    await tx.adminAvailability.deleteMany({ where: { id } });
    await writeAudit(tx, ctx, "update_availability", "setting:demo.availability", { removed: { id, weekday: row.weekday, startMinute: row.startMinute, endMinute: row.endMinute } }, null);
  });
  return { id };
}
