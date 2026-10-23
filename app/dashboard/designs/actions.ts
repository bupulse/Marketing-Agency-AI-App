"use server";

// The Designs gallery's actions: delete a design, prepare its download. Pictures are made by the image engine
// (engine-actions.ts, docs/IMAGE_ENGINE.md); the template and "describe an image" actions are no more (owner decision,
// 23 October 2026: no templates).
import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth/require-user";
import { logError } from "@/lib/errors";
import { deleteDesign as removeDesign, designDownloadUrl } from "@/lib/designs/service";

function revalidate(subjectId: string | null) {
  revalidatePath("/dashboard/designs");
  if (subjectId) {
    revalidatePath("/dashboard/knowledge/products/[id]", "page");
    revalidatePath("/dashboard/knowledge/campaigns/[id]", "page");
  }
}

export async function deleteDesign(designId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireActiveUser();
  if (typeof designId !== "string" || !designId) return { ok: false, error: "Design not found." };
  try {
    const removed = await removeDesign(user.id, designId);
    if (!removed) return { ok: false, error: "Design not found." };
    revalidate(null);
    return { ok: true };
  } catch (error) {
    void logError(error, { source: "designs.delete", userId: user.id });
    return { ok: false, error: "We could not delete that design. Please try again." };
  }
}

export async function getDesignDownloadUrl(designId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await requireActiveUser();
  if (typeof designId !== "string" || !designId) return { ok: false, error: "Design not found." };
  try {
    const url = await designDownloadUrl(user.id, designId);
    return url ? { ok: true, url } : { ok: false, error: "Design not found." };
  } catch (error) {
    void logError(error, { source: "designs.download", userId: user.id });
    return { ok: false, error: "We could not prepare the download. Please try again." };
  }
}
