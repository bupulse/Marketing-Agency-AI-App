import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { AI_PROVIDER_SERVICE } from "@/lib/admin/service-catalog";
import { assertServiceEnabled } from "@/lib/admin/switch";
import { assertCompanyWithinBudget, assertWithinBudget } from "./budget";
import { estimateCostUsd } from "./pricing";
import { AIProviderError, type TokenUsage } from "./types";
import { waitUntil } from "@/lib/platform/background";

/**
 * Thrown by a caller that stopped waiting (its own time limit) while the provider kept working: the provider still
 * answers, and bills, after we gave up. withLedger records that late answer's real usage when it arrives.
 */
export class LateCallError<T = unknown> extends Error {
  constructor(
    message: string,
    public late: Promise<T>,
  ) {
    super(message);
  }
}

/** Rejects with LateCallError after `ms`, carrying the still-running call so the ledger can record what it cost. */
export function withLateTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new LateCallError(message, promise)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export type LedgerContext = { userId?: string | null; businessId?: string | null; feature: string };

/**
 * Runs one AI call and records it in the cost ledger (AiCall), whether it succeeds or fails.
 * `describe` reads provider, model and usage from the result. Recording never breaks the call.
 */
export async function withLedger<T>(
  context: LedgerContext,
  meta: { provider: string; model: string },
  call: () => Promise<T>,
  describe: (result: T) => { provider: string; model: string; usage: TokenUsage; images?: number },
): Promise<T> {
  // The admin console can switch a provider off: refuse before calling it. Not recorded as a call.
  const service = AI_PROVIDER_SERVICE[meta.provider];
  if (service) await assertServiceEnabled(service);
  // Over the monthly cap: refuse before calling (and paying) the provider. Not recorded as a call.
  await assertWithinBudget(meta.provider);
  // Each company has its own monthly allowance too (AI_COMPANY_MONTHLY_USD), so one account cannot use up the cap;
  // the website chat may use only its share of it (WIDGET_AI_SHARE), the rest stays the owner's.
  if (context.businessId) await assertCompanyWithinBudget(context.businessId, meta.provider, new Date(), context.feature);
  const started = Date.now();
  try {
    const result = await call();
    const info = describe(result);
    await record(context, { ...info, success: true, durationMs: Date.now() - started });
    return result;
  } catch (error) {
    if (error instanceof LateCallError) {
      // We stopped waiting but the provider did not: record its real usage once the answer lands (one row).
      const late = (error.late as Promise<T>).then(
        (result) => record(context, { ...describe(result), success: false, error: `${error.message} (answered late, still billed)`.slice(0, 500), durationMs: Date.now() - started }),
        (failure) => record(context, failureEntry(meta, failure, started)),
      );
      waitUntil(late.catch(() => undefined));
      throw error;
    }
    await record(context, failureEntry(meta, error, started));
    throw error;
  }
}

/** A failed call's row: the usage a provider billed before failing (blocked, unparsable, timed out) when it is known. */
function failureEntry(meta: { provider: string; model: string }, error: unknown, started: number) {
  const billed = error instanceof AIProviderError ? error : undefined;
  return {
    provider: meta.provider,
    model: billed?.model ?? meta.model,
    usage: billed?.usage ?? { inputTokens: 0, outputTokens: 0 },
    images: billed?.images,
    estimated: billed?.estimated ?? false,
    success: false,
    error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
    durationMs: Date.now() - started,
  };
}

async function record(
  context: LedgerContext,
  entry: { provider: string; model: string; usage: TokenUsage; images?: number; estimated?: boolean; success: boolean; error?: string; durationMs: number },
) {
  try {
    await prisma.aiCall.create({
      data: {
        userId: context.userId ?? null,
        businessId: context.businessId ?? null,
        feature: context.feature,
        provider: entry.provider,
        model: entry.model,
        inputTokens: entry.usage.inputTokens,
        outputTokens: entry.usage.outputTokens,
        images: entry.images ?? 0,
        estimated: entry.estimated ?? false,
        costUsd: estimateCostUsd(entry.model, { ...entry.usage, images: entry.images }),
        durationMs: entry.durationMs,
        success: entry.success,
        error: entry.error ?? null,
      },
    });
  } catch (error) {
    await logError(error, { source: "ai.ledger", level: "warn" });
  }
}
