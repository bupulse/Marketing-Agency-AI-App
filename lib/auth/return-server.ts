import "server-only";
import { cookies } from "next/headers";
import { siteUrl } from "./site-url";
import { cleanReturn, hasReturn, RETURN_COOKIE, returnCookieOptions } from "./return-path";

/** Remembers `next` for the sign-up steps (server actions and route handlers that can write cookies). */
export async function rememberReturn(next: string | null | undefined) {
  if (!hasReturn(next)) return;
  (await cookies()).set(RETURN_COOKIE, cleanReturn(next), returnCookieOptions(siteUrl().startsWith("https://")));
}

/** The remembered path, or the dashboard. Safe to call from pages (does not clear it). */
export async function readReturn(): Promise<string> {
  return cleanReturn((await cookies()).get(RETURN_COOKIE)?.value);
}

/** Reads and clears (server actions only). */
export async function takeReturn(): Promise<string> {
  const store = await cookies();
  const value = cleanReturn(store.get(RETURN_COOKIE)?.value);
  store.delete(RETURN_COOKIE);
  return value;
}
