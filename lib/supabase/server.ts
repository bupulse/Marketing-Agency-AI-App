import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { loadServiceKeys } from "@/lib/admin/service-keys";
import { screenPassUser } from "@/lib/ad-brain/screen-user";

// Create a new client per request (never share one across requests).
export async function createClient() {
  // Every page and action that reads the session also gets the keys saved in Admin -> Services (cached, 30 s).
  const [cookieStore] = await Promise.all([cookies(), loadServiceKeys()]);

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The proxy refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
}

// The signed-in user, verified with Supabase Auth, or null. Without a session, the Ad Brain's screen robot (the
// server's own headless Chrome with a 5-minute signed pass, read-only, BuPulse's company account only;
// lib/ad-brain/screen-pass.ts) is that account; nobody else can carry such a pass.
export async function getCurrentUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (!error && data.user) return data.user;
  return screenPassUser();
}
