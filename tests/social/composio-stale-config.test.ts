import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAt, jsonResponse, mockFetch } from "./helpers";

// After the Composio API key is replaced by one from another project, the saved "BuPulse-Socials <Network>" auth config
// ids belong to the old project: connecting must forget the refused id, find or make this project's config, and go on.

const h = vi.hoisted(() => ({ saved: { instagram: "ac_old_project" } as Record<string, string> }));
vi.mock("@/lib/db", () => ({
  prisma: {
    adminSetting: {
      findUnique: vi.fn(async () => ({ value: { ...h.saved } })),
      upsert: vi.fn(async ({ update }: { update: { value: Record<string, string> } }) => {
        h.saved = { ...update.value };
        return {};
      }),
    },
  },
}));
vi.mock("@/lib/social/inbox/budget", () => ({ countComposioCalls: vi.fn(async () => {}) }));

import { createConnectLink } from "@/lib/social/composio/client";
import { SocialError } from "@/lib/social/types";

beforeEach(() => {
  process.env.COMPOSIO_API_KEY = "ak_new_project";
  h.saved = { instagram: "ac_old_project" };
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.COMPOSIO_API_KEY;
});

describe("Composio connect after the key moved to another project", () => {
  it("forgets a refused saved auth config, finds this project's one, saves it and returns the sign-in link", async () => {
    const fetch = mockFetch(
      jsonResponse({ error: { message: "Auth config not found" } }, { status: 400 }),
      jsonResponse({ items: [{ id: "ac_new_project", name: "BuPulse-Socials Instagram", is_composio_managed: true, status: "ENABLED" }] }),
      jsonResponse({ redirect_url: "https://connect.composio.dev/link/abc", connected_account_id: "ca_1" }),
    );
    const out = await createConnectLink("instagram", "biz1", "https://bupulse.com/api/social/instagram/composio?state=s");
    expect(out).toEqual({ url: "https://connect.composio.dev/link/abc", connectedAccountId: "ca_1" });
    expect(JSON.parse(callAt(fetch, 0).body!).auth_config_id).toBe("ac_old_project");
    expect(callAt(fetch, 1).url).toContain("/auth_configs?toolkit_slug=instagram");
    expect(JSON.parse(callAt(fetch, 2).body!).auth_config_id).toBe("ac_new_project");
    expect(h.saved.instagram).toBe("ac_new_project");
  });

  it("does not retry when the key itself is refused (401): that is a key problem, not a stale id", async () => {
    const fetch = mockFetch(jsonResponse({ error: { message: "Invalid API key" } }, { status: 401 }));
    await expect(createConnectLink("instagram", "biz1", "https://bupulse.com/cb")).rejects.toBeInstanceOf(SocialError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(h.saved.instagram).toBe("ac_old_project");
  });
});
