import { prisma } from "@/lib/db";
import { isCanvaEnabled } from "@/lib/canva/config";
import { disconnectCanva } from "@/lib/canva/tokens";
import type { ConnectorEntry } from "../types";

/** Canva: "Edit in Canva" (Phase 4) and "Import from Canva" share one OAuth connection. */
export const connector: ConnectorEntry = {
  id: "canva",
  name: "Canva",
  group: "design",
  description: "Import your Canva designs as photos, and edit BuPulse designs in Canva.",
  icon: "palette",
  async status({ userId }) {
    if (!isCanvaEnabled()) return { state: "unavailable" };
    const row = await prisma.canvaConnection.findUnique({ where: { userId }, select: { id: true } });
    return row ? { state: "connected" } : { state: "not_connected" };
  },
  connectHref: "/api/canva/connect?next=/dashboard/gallery",
  manageHref: "/dashboard/gallery",
  disconnect: ({ userId }) => disconnectCanva(userId),
};
