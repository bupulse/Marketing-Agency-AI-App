"use server";

import { requireAdmin } from "@/lib/admin/auth";
import { actionMessage, adminAction } from "@/lib/admin/console";
import { assertLabOwner } from "@/lib/training-lab/examples";
import { openFinishedReel, type OpenedReel } from "./reels";

export type OpenReelResult = ({ ok: true } & OpenedReel) | { ok: false; error: string };

/** Opens a finished reel for the editor, with fresh signed links. Owner only, like every Training Lab action. */
export async function openReelAction(id: string): Promise<OpenReelResult> {
  const ctx = await adminAction("ai");
  const identity = await requireAdmin();
  try {
    assertLabOwner(ctx, identity);
    const opened = await openFinishedReel(String(id ?? ""));
    return opened ? { ok: true, ...opened } : { ok: false, error: "That reel is not finished or is gone. Refresh the page." };
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
}
