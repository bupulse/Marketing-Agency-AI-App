// An ad's statuses that never move on again (lib/ad-brain/pipeline.ts). Pure, so Admin views can read it.
export const TERMINAL = ["ready", "failed", "stopped", "cancelled"] as const;
export const isFinished = (status: string) => (TERMINAL as readonly string[]).includes(status);
