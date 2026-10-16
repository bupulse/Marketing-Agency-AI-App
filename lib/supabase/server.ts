import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { loadServiceKeys } from "@/lib/admin/service-keys";

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

// The signed-in user, verified with Supabase Auth, or null.
export async function getCurrentUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}
