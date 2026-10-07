import "server-only";
import { prisma } from "@/lib/db";
import { deleteConnections } from "./connections";

/**
 * Deletes every Facebook and Instagram connection that belongs to a Meta user id (from a signed_request).
 * Connections remember it as a "meta_uid:<id>" scope entry; an Instagram connection's own account id also counts.
 * Returns how many connections were removed.
 */
export async function deleteMetaConnections(metaUserId: string): Promise<number> {
  const rows = await prisma.connection.findMany({
    where: {
      provider: { in: ["facebook", "instagram"] },
      OR: [{ scopes: { has: `meta_uid:${metaUserId}` } }, { provider: "instagram", externalAccountId: metaUserId }],
    },
    select: { id: true },
  });
  await deleteConnections(rows.map((r) => r.id));
  return rows.length;
}
