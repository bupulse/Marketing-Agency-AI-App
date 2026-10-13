// Who may call the video robot API (docs/VIDEO_ROBOT.md): the GitHub Actions job with VIDEO_ROBOT_SECRET as a bearer
// token. No session. Off (404) while the secret is unset; rate-limited per IP before the secret is even compared.
import "server-only";
import { NextResponse } from "next/server";
import { clientIp } from "@/lib/platform";
import { RATE_LIMITS, rateLimit, RateLimitError } from "@/lib/rate-limit";

/** Constant-time comparison (the length difference is folded in, never returned early). */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const json = (body: object, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Null when the caller is the robot; otherwise the response to send (404 off, 429 too many, 401 wrong secret). */
export async function robotGuard(request: Request): Promise<NextResponse | null> {
  const secret = process.env.VIDEO_ROBOT_SECRET;
  if (!secret) return json({ error: "Not found" }, 404);
  try {
    await rateLimit(`video-robot:${clientIp(request.headers) ?? "unknown"}`, RATE_LIMITS.videoRobot);
  } catch (error) {
    if (error instanceof RateLimitError) return json({ error: "Too many requests" }, 429);
    throw error;
  }
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return json({ error: "Unauthorized" }, 401);
  return null;
}

/** The JSON body, or null when it is not an object. */
export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export { json as robotJson };
