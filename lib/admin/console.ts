import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdmin } from "./auth";
import { AdminError, consoleContext, type AdminContext } from "./types";
import { prisma } from "@/lib/db";
import { APPROVAL_TTL_MS } from "./service";
import { logError } from "@/lib/errors";
import { clientIp } from "@/lib/platform/headers";

/**
 * Start of every console server action: re-checks the admin (email, verified, AAL2) and returns the
 * audit context. Server actions are public POST endpoints, so the layout's check is never enough.
 */
export async function adminAction(): Promise<AdminContext> {
  await requireAdmin();
  const h = await headers();
  const ip = clientIp(h);
  return consoleContext(ip);
}

/** Message to show for a failed action. AdminError text is written for people; anything else is generic. */
export function actionMessage(e: unknown): string {
  if (e instanceof AdminError) return e.message;
  void logError(e, { source: "admin.console" });
  return "Something went wrong. Nothing was changed; please try again.";
}

/**
 * Parses `back` and keeps it only if the normalised path is /admin or under /admin/ and is not protocol-relative
 * ("/admin/..//evil.com" normalises to "//evil.com"). Anything else becomes /admin.
 */
export function safeAdminUrl(back: string): URL {
  try {
    const url = new URL(back, "http://x");
    const path = url.pathname;
    if (url.origin === "http://x" && !path.startsWith("//") && (path === "/admin" || path.startsWith("/admin/"))) return url;
  } catch {
    /* falls through */
  }
  return new URL("/admin", "http://x");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A user id from a form: refuses anything that is not a UUID. */
export function userIdOf(value: string): string {
  if (!UUID.test(value)) throw new AdminError("invalid", "That is not a valid user id.");
  return value.toLowerCase();
}

/** Runs `fn`, then returns to `back` with ?notice= or ?error=. redirect() is called outside the try block. */
export async function finish<T>(back: string, ok: string | ((result: T) => string), fn: () => Promise<T>): Promise<never> {
  let error: string | null = null;
  let message = typeof ok === "string" ? ok : "";
  try {
    const result = await fn();
    if (typeof ok !== "string") message = ok(result);
  } catch (e) {
    error = actionMessage(e);
  }
  const url = safeAdminUrl(back);
  url.searchParams.delete("notice");
  url.searchParams.delete("error");
  url.searchParams.set(error ? "error" : "notice", error ?? message);
  redirect(url.pathname + url.search + url.hash);
}

/** Number of money requests waiting for the owner (sidebar badge). */
export async function pendingApprovalCount(): Promise<number> {
  return prisma.adminApproval.count({ where: { status: "pending", createdAt: { gt: new Date(Date.now() - APPROVAL_TTL_MS) } } });
}
