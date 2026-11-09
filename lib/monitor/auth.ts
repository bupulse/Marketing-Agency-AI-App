// Bearer checks for the monitoring routes (/api/monitor/*), the same way /api/cron/* check theirs. Pure.

/** Compares without stopping at the first different character. */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** True when `authorization` is exactly "Bearer <secret>". An empty or missing secret never matches. */
export function bearerMatches(authorization: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret) return false;
  return safeEqual(authorization ?? "", `Bearer ${secret}`);
}

/** Reads a JSON body of at most `maxBytes`. Null when it is bigger, empty or not JSON. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown | null> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > maxBytes) return null;
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (!text || new TextEncoder().encode(text).length > maxBytes) return null;
  try {
    // Windows PowerShell may start the body with a byte order mark.
    return JSON.parse(text.replace(/^﻿/, "")) as unknown;
  } catch {
    return null;
  }
}
