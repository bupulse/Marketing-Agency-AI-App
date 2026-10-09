"use server";

import { revalidatePath } from "next/cache";
import { requirePersonalUser } from "@/lib/auth/require-user";
import { disconnectCanva } from "@/lib/canva/tokens";

/** Unlinks the user's Canva account from BuPulse (the stored tokens are deleted). */
export async function disconnectCanvaAction() {
  const user = await requirePersonalUser();
  await disconnectCanva(user.id);
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/connections");
}
