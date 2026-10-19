// Password gate for the Video Studio when it is reachable online (video.bupulse.com through a tunnel to
// localhost:3100). Requests made on this computer (Host localhost:3100 or 127.0.0.1:3100, and no proxy headers) pass
// as before, so local automation keeps working; every other request needs the studio cookie, which is an HMAC of
// STUDIO_PASSWORD with a secret kept in video-lab/data (changing the password signs everyone out). The password is
// never printed or logged.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type http from "node:http";

export const COOKIE = "bp_studio";
export const COOKIE_DAYS = 30;
const SECRET_FILE = path.resolve("video-lab/data/gate-secret");

/** Headers a tunnel or proxy adds: their presence means the request did not start on this computer. */
const PROXY_HEADERS = ["x-forwarded-for", "x-forwarded-host", "x-real-ip", "cf-connecting-ip", "cf-ray", "forwarded"];

export function isLocal(headers: http.IncomingHttpHeaders, port: number): boolean {
  const host = String(headers.host ?? "").toLowerCase();
  if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) return false;
  // A tunnel set to rewrite Host to localhost still adds these, so it never counts as local.
  return !PROXY_HEADERS.some((h) => headers[h] !== undefined);
}

/** The secret the cookie is signed with: made once, kept across restarts so a restart does not sign people out. */
export async function loadSecret(): Promise<Buffer> {
  try {
    const hex = (await fs.readFile(SECRET_FILE, "utf8")).trim();
    if (/^[0-9a-f]{64}$/.test(hex)) return Buffer.from(hex, "hex");
  } catch {
    // First start.
  }
  const secret = randomBytes(32);
  await fs.mkdir(path.dirname(SECRET_FILE), { recursive: true });
  await fs.writeFile(SECRET_FILE, secret.toString("hex"), { mode: 0o600 });
  return secret;
}

export const tokenFor = (password: string, secret: Buffer) => createHmac("sha256", secret).update(`studio:${password}`).digest("base64url");

/** Constant-time comparison of two strings of any length (both are hashed first). */
export function sameText(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function cookieValue(headers: http.IncomingHttpHeaders, name = COOKIE): string | null {
  for (const part of String(headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export const isHttps = (headers: http.IncomingHttpHeaders) => String(headers["x-forwarded-proto"] ?? "").split(",")[0].trim().toLowerCase() === "https";

export function setCookieHeader(token: string, headers: http.IncomingHttpHeaders): string {
  return `${COOKIE}=${token}; Path=/; Max-Age=${COOKIE_DAYS * 86400}; HttpOnly; SameSite=Lax${isHttps(headers) ? "; Secure" : ""}`;
}

export const clearCookieHeader = (headers: http.IncomingHttpHeaders) => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${isHttps(headers) ? "; Secure" : ""}`;

/** The visitor's address: the first x-forwarded-for value (the tunnel's), else the socket's. */
export function clientIp(req: http.IncomingMessage): string {
  const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return fwd || String(req.headers["cf-connecting-ip"] ?? "") || req.socket.remoteAddress || "unknown";
}

/** Only paths on this site: "/x?y" yes; "//evil.com", "https://…", "/\\evil" no. */
export function safeNext(next: unknown): string {
  const s = typeof next === "string" ? next : "";
  return /^\/(?![/\\])[^\s]*$/.test(s) && !s.startsWith("/login") ? s : "/";
}

/** At most `max` tries per address in a sliding window. */
export class RateLimiter {
  private tries = new Map<string, number[]>();
  constructor(
    private readonly max = 10,
    private readonly windowMs = 10 * 60_000,
  ) {}
  /** Counts a try; false when the address has used its tries. */
  hit(key: string, now = Date.now()): boolean {
    const recent = (this.tries.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.tries.set(key, recent);
      return false;
    }
    recent.push(now);
    this.tries.set(key, recent);
    if (this.tries.size > 5000) for (const [k, v] of this.tries) if (!v.some((t) => now - t < this.windowMs)) this.tries.delete(k);
    return true;
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

export function loginPage(next: string, error: string | null): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sign in · BuPulse Video Studio</title>
<link rel="stylesheet" href="/site.css">
</head>
<body>
<main class="login">
  <a class="brand" href="/login"><span class="logo">B</span> BuPulse <b>Video Studio</b></a>
  <form class="card" method="post" action="/login">
    <h1>Welcome back</h1>
    <p class="muted">The studio is private while we test it. Enter the studio password to continue.</p>
    <input type="hidden" name="next" value="${esc(next)}">
    <label class="l" for="password">Password</label>
    <input type="password" id="password" name="password" autocomplete="current-password" required autofocus>
    ${error ? `<p class="err">${esc(error)}</p>` : ""}
    <button class="btn primary big" type="submit">Open the studio</button>
    <p class="muted small">You stay signed in on this device for ${COOKIE_DAYS} days.</p>
  </form>
</main>
</body>
</html>`;
}

/** A plain page for a person the studio is closed to (switched off, no permission, no video credits), with a way back. */
export function noticePage(message: string, href: string, linkText: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Video Studio · BuPulse</title>
<link rel="stylesheet" href="/site.css">
</head>
<body>
<main class="login">
  <a class="brand" href="${esc(href)}"><span class="logo">B</span> BuPulse <b>Video Studio</b></a>
  <div class="card">
    <h1>The studio is not open to you yet</h1>
    <p class="muted">${esc(message)}</p>
    <a class="btn primary big" href="${esc(href)}">${esc(linkText)}</a>
  </div>
</main>
</body>
</html>`;
}
