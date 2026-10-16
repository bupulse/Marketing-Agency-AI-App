import { hostOf } from "./origin";
import { clientIp } from "@/lib/platform/headers";

/** Visitor IP, hashed so raw addresses are not stored in the rate-limit table. */
export async function clientIpHash(request: Request): Promise<{ ip: string | null; hash: string }> {
  const ip = clientIp(request.headers);
  const data = new TextEncoder().encode(`bupulse-widget:${ip ?? "unknown"}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hash = [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { ip, hash };
}

/** Hostnames that are BuPulse itself (the dashboard preview is allowed on any widget). */
export function ownHostsFor(request: Request): string[] {
  const hosts = new Set<string>();
  const add = (value: string | null | undefined) => {
    const h = hostOf(value);
    if (h) hosts.add(h);
  };
  add(request.headers.get("host"));
  add(process.env.NEXT_PUBLIC_SITE_URL);
  return [...hosts];
}
