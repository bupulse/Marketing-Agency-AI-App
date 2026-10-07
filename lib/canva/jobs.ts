export class CanvaTimeoutError extends Error {
  constructor() {
    super("Canva took too long to finish");
  }
}

export type PollResult<T> = { done: true; value: T } | { done: false };

type Options = { maxMs: number; firstDelayMs?: number; maxDelayMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number };

/**
 * Calls `poll` until it reports done, waiting longer between calls (x1.5, up to maxDelayMs) and giving
 * up with CanvaTimeoutError once `maxMs` has passed in total. Canva jobs are asynchronous.
 */
export async function pollJob<T>(poll: () => Promise<PollResult<T>>, options: Options): Promise<T> {
  const { maxMs, firstDelayMs = 500, maxDelayMs = 3000, sleep = (ms) => new Promise<void>((r) => setTimeout(r, ms)), now = Date.now } = options;
  const started = now();
  let delay = firstDelayMs;
  for (;;) {
    const result = await poll();
    if (result.done) return result.value;
    if (now() - started + delay > maxMs) throw new CanvaTimeoutError();
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.5), maxDelayMs);
  }
}
