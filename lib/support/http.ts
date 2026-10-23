import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { loadServiceKeys } from "@/lib/admin/service-keys";
import { logError } from "@/lib/errors";
import { RateLimitError, rateLimit, type RateLimitRule } from "@/lib/rate-limit";

// The support API's answers (contract.ts): JSON, never cached, and every error as { error: { code, message } } with a
// message a person can read. Services throw SupportError; route() turns it (and a rate limit, and anything else) into
// the right answer.

export class SupportError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public headers?: Record<string, string>,
  ) {
    super(message);
  }
}

const NO_STORE = { "cache-control": "no-store" };

export function errorResponse(status: number, code: string, message: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { ...NO_STORE, ...headers } });
}

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function noContent() {
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}

export function rateLimitText(seconds: number) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `You're sending a lot. Please wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`;
}

/** Counts one hit; over the limit throws a 429 SupportError with Retry-After. */
export async function limit(key: string, rule: RateLimitRule) {
  try {
    await rateLimit(key, rule);
  } catch (error) {
    if (error instanceof RateLimitError) throw new SupportError(429, "rate_limited", rateLimitText(error.retryAfterSeconds), { "retry-after": String(error.retryAfterSeconds) });
    throw error;
  }
}

/** The request's JSON body; an empty or broken body is a 400. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new SupportError(400, "invalid_json", "The request body must be JSON.");
  }
}

/** Parses with a contract schema; the first problem becomes the message. */
export function parse<T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  throw new SupportError(400, "invalid_request", `${field}${issue?.message ?? "The request is not valid."}`.slice(0, 300));
}

/**
 * Wraps a route handler: loads the keys saved in Admin -> Services (these routes skip the proxy), and turns errors into
 * the contract's error shape. Unknown errors are logged and answered with a plain 500.
 */
export function route<C>(handler: (request: NextRequest, ctx: C) => Promise<Response>) {
  return async (request: NextRequest, ctx: C): Promise<Response> => {
    try {
      await loadServiceKeys();
      return await handler(request, ctx);
    } catch (error) {
      if (error instanceof SupportError) return errorResponse(error.status, error.code, error.message, error.headers);
      if (error instanceof RateLimitError) return errorResponse(429, "rate_limited", rateLimitText(error.retryAfterSeconds), { "retry-after": String(error.retryAfterSeconds) });
      await logError(error, { source: "support.api", path: new URL(request.url).pathname });
      return errorResponse(500, "server_error", "Something went wrong on our side. Please try again in a moment.");
    }
  };
}
