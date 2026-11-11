"use server";

import { redirect } from "next/navigation";
import type { PickState } from "@/components/platform/service-cards";
import { serviceHome } from "@/lib/platform/app-hosts";
import { PICKED_AT_KEY, PICKED_KEY, pickedServices, readPicks } from "@/lib/platform/services-shared";
import { createClient } from "@/lib/supabase/server";

/**
 * "What do you want to start?": keeps the picks in the account (Supabase user metadata, services_picked), so phase 2
 * can create the Agency workspace of everyone who asked for it, then opens Marketing (its free trial and set-up) or
 * says they are on Agency's list.
 */
export async function pickServices(_prev: PickState, form: FormData): Promise<PickState> {
  const picks = readPicks(form.getAll("service"));
  if (picks.length === 0) return { error: "Pick at least one service." };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?next=/apps/start");
  // Agency stays on the list once asked for, even when a later visit only ticks Marketing.
  const kept = [...new Set([...pickedServices(data.user.user_metadata), ...picks])];
  const { error } = await supabase.auth.updateUser({ data: { [PICKED_KEY]: kept, [PICKED_AT_KEY]: new Date().toISOString() } });
  if (error) return { error: "We could not save that. Please try again." };
  if (picks.includes("marketing")) redirect(serviceHome("marketing") ?? "/dashboard");
  redirect("/apps/start?listed=1");
}
