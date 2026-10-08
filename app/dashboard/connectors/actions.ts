"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth/require-user";
import { findEntry } from "@/lib/connectors/catalog";
import { prisma } from "@/lib/db";

export type DisconnectResult = { ok: true } | { ok: false; error: string };

/** Removes the stored access for one connector of the signed-in owner's business. */
export async function disconnectConnector(id: string): Promise<DisconnectResult> {
  const user = await requireActiveUser();
  const entry = typeof id === "string" ? findEntry(id) : undefined;
  if (!entry) return { ok: false, error: "That connector is not available." };
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) return { ok: false, error: "We could not find your business." };
  try {
    await entry.disconnect({ userId: user.id, businessId: business.id });
  } catch (error) {
    console.error(`[connectors] disconnect ${id} failed:`, error instanceof Error ? error.message : error);
    return { ok: false, error: "We could not disconnect it. Nothing was changed. Please try again." };
  }
  revalidatePath("/dashboard/connectors");
  return { ok: true };
}
