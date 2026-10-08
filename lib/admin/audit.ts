import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { redact } from "@/lib/errors";
import type { AdminContext } from "./types";

type Db = Pick<typeof prisma, "auditLog">;

// Serialise first (Dates become ISO strings), then hide anything secret-looking.
const json = (value: unknown): Prisma.InputJsonValue | undefined =>
  value === undefined || value === null ? undefined : (redact(JSON.parse(JSON.stringify(value))) as Prisma.InputJsonValue);

/**
 * Appends one AuditLog row. Pass the transaction client as `db` to make the audit row and the change one unit.
 * The table is append-only (a database trigger refuses UPDATE and DELETE).
 */
export async function writeAudit(
  db: Db,
  ctx: AdminContext,
  action: string,
  target: string | null,
  before: unknown,
  after: unknown,
) {
  await db.auditLog.create({
    data: { actor: ctx.actor, action, target, before: json(before), after: json(after), ip: ctx.ip ?? null },
  });
}
