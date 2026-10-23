import { createHttpClient, type SupportClient } from "@/lib/support/client/api";

/** The client for /api/support/v1. (The pretend server in lib/support/client/mock.ts is for tests only.) */
export async function makeClient(): Promise<SupportClient> {
  return createHttpClient();
}
