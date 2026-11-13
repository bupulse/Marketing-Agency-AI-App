import { prisma } from "@/lib/db";

export type ErrorContext = {
  source: string;
  level?: "error" | "warn";
  userId?: string;
  businessId?: string;
  [key: string]: unknown;
};

const SECRET_KEY = /token|secret|password|passwd|api[-_]?key|authorization|cookie|credential|private/i;
const MAX_DEPTH = 4;

// Copy of the value with anything secret-looking replaced, safe to store as JSON.
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") {
    return typeof value === "function" || typeof value === "symbol"
      ? String(value)
      : typeof value === "bigint"
        ? value.toString()
        : value;
  }
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? "[redacted]" : redact(item, depth + 1),
    ]),
  );
}

// Writes to ErrorLog. Never throws: if the database write fails it falls back to the console. Errors marked with
// `serviceFault` are skipped (see below).
export async function logError(
  error: unknown,
  context: ErrorContext,
): Promise<void> {
  // A partner fault already recorded once (lib/admin/service-faults.ts: a refused API key, a plan limit) is one item on
  // Admin -> Health, not one row here per call.
  if (error && typeof error === "object" && typeof (error as { serviceFault?: unknown }).serviceFault === "string") return;
  const { source, level = "error", userId, businessId, ...rest } = context;
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  try {
    await prisma.errorLog.create({
      data: {
        level,
        source,
        message,
        stack,
        userId,
        businessId,
        context: Object.keys(rest).length
          ? (JSON.parse(JSON.stringify(redact(rest))) as object)
          : undefined,
      },
    });
  } catch (writeError) {
    console.error(`[${source}]`, error, "(ErrorLog write failed)", writeError);
  }
}
