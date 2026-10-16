import { AsyncLocalStorage } from "node:async_hooks";

// Marks work done by a scheduled job (lib/admin/cron-run.ts recordCron). Links it puts in emails must not follow the
// Host of the request that started the job (a cron call to http://localhost:3001 on the test machine): they use the
// public address instead (lib/auth/request-site.ts).

const store = new AsyncLocalStorage<true>();

export const runAsBackgroundJob = <T>(fn: () => Promise<T>): Promise<T> => store.run(true, fn);
export const inBackgroundJob = (): boolean => store.getStore() === true;
