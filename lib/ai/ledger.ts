import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { estimateCostUsd } from "./pricing";
import { AIProviderError, type TokenUsage } from "./types";

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
  const started = Date.now();
  try {
    const result = await call();
    const info = describe(result);
    await record(context, { ...info, success: true, durationMs: Date.now() - started });
    return result;
  } catch (error) {
    // A provider that billed tokens before failing (blocked, unparsable) reports them on the error.
    const billed = error instanceof AIProviderError ? error : undefined;
    await record(context, {
      provider: meta.provider,
      model: billed?.model ?? meta.model,
      usage: billed?.usage ?? { inputTokens: 0, outputTokens: 0 },
      success: false,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      durationMs: Date.now() - started,
    });
    throw error;
  }
}

async function record(
  context: LedgerContext,
  entry: { provider: string; model: string; usage: TokenUsage; images?: number; success: boolean; error?: string; durationMs: number },
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
