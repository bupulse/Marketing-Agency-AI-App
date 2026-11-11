import "server-only";
import { cookies } from "next/headers";
import { cleanReturn, hasReturn, RETURN_COOKIE, returnCookieOptions } from "./return-path";
import { secureCookies } from "./request-site";
import { safeNext } from "./safe-next";

/** The Marketing sign-up steps (/welcome, /onboarding) end on the dashboard when nothing was remembered. */
const stepsReturn = (value: string | undefined) => safeNext(value, "/dashboard");

/** Remembers `next` for the sign-up steps (server actions and route handlers that can write cookies). */
export async function rememberReturn(next: string | null | undefined) {
  if (!hasReturn(next)) return;
  (await cookies()).set(RETURN_COOKIE, cleanReturn(next), returnCookieOptions(await secureCookies()));
}

/** The remembered path, or the dashboard. Safe to call from pages (does not clear it). */
export async function readReturn(): Promise<string> {
  return stepsReturn((await cookies()).get(RETURN_COOKIE)?.value);
}

/** Reads and clears (server actions only). */
export async function takeReturn(): Promise<string> {
  const store = await cookies();
  const value = stepsReturn(store.get(RETURN_COOKIE)?.value);
  // With the same domain it was set with (the client hosts share it), or the browser would keep it.
  store.set(RETURN_COOKIE, "", { ...returnCookieOptions(await secureCookies()), maxAge: 0 });
  return value;
}
