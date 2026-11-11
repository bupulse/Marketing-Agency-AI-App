import { createBrowserClient } from "@supabase/ssr";
import { AUTH_SCOPE_COOKIE, authCookieFromScope } from "@/lib/platform/app-hosts";

/**
 * The session cookie this host uses, from the small cookie the proxy sets (the browser cannot read the server's
 * environment): the shared client cookie (Domain=.bupulse.com), the admin host's own, or Supabase's default.
 */
function sessionCookieOptions() {
  if (typeof document === "undefined") return undefined;
  const value = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${AUTH_SCOPE_COOKIE}=`))
    ?.slice(AUTH_SCOPE_COOKIE.length + 1);
  const cookie = authCookieFromScope(value ? decodeURIComponent(value) : null);
  if (!cookie) return undefined;
  return { name: cookie.name, ...(cookie.domain ? { domain: cookie.domain } : {}), path: "/", sameSite: "lax" as const, secure: location.protocol === "https:" };
}

// Browser client: only ever uses the public URL and publishable key.
export function createClient() {
  const cookieOptions = sessionCookieOptions();
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, cookieOptions ? { cookieOptions } : undefined);
}
