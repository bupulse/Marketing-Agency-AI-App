// The person a screen robot's pass stands for (lib/ad-brain/screen-pass.ts), for getCurrentUser: the BuPulse company
// account, and only when the request carries a genuine, unexpired pass AND comes from this computer itself. The proxy
// has already refused anything but GET/HEAD on dashboard pages; this is the second check, at the data.
import "server-only";
import type { User } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { adBrainCompanyEmail, isLocalRequest, readScreenPass, SCREEN_PASS_COOKIE, screenPassSecret } from "./screen-pass";

export async function screenPassUser(): Promise<User | null> {
  let token: string | undefined;
  let local = false;
  try {
    const [jar, h] = await Promise.all([cookies(), headers()]);
    token = jar.get(SCREEN_PASS_COOKIE)?.value;
    if (!token) return null;
    local = isLocalRequest({ host: h.get("host"), cfConnectingIp: h.get("cf-connecting-ip"), forwardedFor: h.get("x-forwarded-for"), realIp: h.get("x-real-ip"), forwardedHost: h.get("x-forwarded-host"), forwarded: h.get("forwarded") });
  } catch {
    // Outside a request (a cron job, a script): there is no pass.
    return null;
  }
  if (!local) return null;
  const pass = await readScreenPass(token, screenPassSecret());
  if (!pass) return null;
  const { data, error } = await createAdminClient().auth.admin.getUserById(pass.userId);
  if (error || !data.user) return null;
  // Only ever the BuPulse company account, whatever the pass says.
  if ((data.user.email ?? "").toLowerCase() !== adBrainCompanyEmail()) return null;
  return data.user;
}
