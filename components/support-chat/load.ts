import { createHttpClient, type SupportClient } from "@/lib/support/client/api";

/**
 * The pretend server (lib/support/client/mock.ts) while sc-core's API is not there: development only, with
 * NEXT_PUBLIC_SUPPORT_CHAT_MOCK=1. A production build never includes it (NODE_ENV is fixed at build time).
 */
export const MOCK = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_SUPPORT_CHAT_MOCK === "1";

export async function makeClient(): Promise<SupportClient> {
  if (MOCK) {
    const { createMockClient } = await import("@/lib/support/client/mock");
    let socket: "live" | "down" = "live";
    try {
      // Polling fallback test: localStorage.setItem("bp-sc-mock-socket", "down")
      if (localStorage.getItem("bp-sc-mock-socket") === "down") socket = "down";
    } catch {}
    return createMockClient({ socket, greetingDelaySec: 4 });
  }
  return createHttpClient();
}
