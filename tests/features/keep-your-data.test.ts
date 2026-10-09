import { beforeEach, describe, expect, it, vi } from "vitest";
import * as grant from "@/tests/stubs/entitlements";

// Losing a plan feature never locks a company out of the data it already has: the leads inbox can still be looked at,
// exported and deleted, and webhook endpoints can still be switched off and deleted, like disconnecting a store or
// revoking an API key. Working the data (status, notes, switching an endpoint on) still needs the feature.

vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));

const h = vi.hoisted(() => ({
  user: { id: "u1", actorId: "u1", businessId: "b1", role: "OWNER", email: "o@example.com" },
  prisma: { business: { findUnique: vi.fn(async () => ({ id: "b1" })) } },
  leads: { deleteLeads: vi.fn(async () => 2), getLeadDetail: vi.fn(async () => ({ id: "l1", session: null })), setLeadStatus: vi.fn(async () => 1), setLeadNotes: vi.fn(async () => true) },
  hooks: { deleteEndpoint: vi.fn(async () => {}), setEndpointEnabled: vi.fn(async () => {}), updateEndpoint: vi.fn(async () => {}) },
}));

vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: vi.fn(async () => h.user) }));
vi.mock("@/lib/leads/service", async (orig) => ({ ...(await orig<typeof import("@/lib/leads/service")>()), ...h.leads }));
vi.mock("@/lib/leads/settings", () => ({ saveEmailToggles: vi.fn() }));
vi.mock("@/lib/webhooks/endpoints", async (orig) => ({ ...(await orig<typeof import("@/lib/webhooks/endpoints")>()), ...h.hooks }));

import { changeStatus, loadLead, removeLeads, saveNotes } from "@/app/dashboard/leads/actions";
import { deleteWebhook, toggleWebhook, updateWebhook } from "@/app/dashboard/connectors/webhooks/actions";

const NO_CHAT = grant.notInPlanMessage("websiteChat");
const NO_HOOKS = grant.notInPlanMessage("webhooks");

beforeEach(() => {
  vi.clearAllMocks();
  grant.missing.clear();
  grant.serviceOff.clear();
  grant.state.planUnknown = false;
});

describe("leads without website chat in the plan", () => {
  beforeEach(() => grant.missing.add("websiteChat"));

  it("can still be looked at and deleted", async () => {
    expect(await loadLead("l1")).toMatchObject({ ok: true, lead: { id: "l1" } });
    expect(await removeLeads(["l1", "l2"])).toEqual({ ok: true, deleted: 2 });
    expect(h.leads.deleteLeads).toHaveBeenCalledWith("b1", ["l1", "l2"]);
  });

  it("cannot be worked: status and notes are refused in words, and nothing is written", async () => {
    expect(await changeStatus(["l1"], "WON")).toEqual({ ok: false, error: NO_CHAT });
    expect(await saveNotes("l1", "called")).toEqual({ ok: false, error: NO_CHAT });
    expect(h.leads.setLeadStatus).not.toHaveBeenCalled();
    expect(h.leads.setLeadNotes).not.toHaveBeenCalled();
  });

  it("works again with the feature", async () => {
    grant.missing.clear();
    expect(await changeStatus(["l1"], "WON")).toEqual({ ok: true, changed: 1 });
  });
});

describe("webhook endpoints without webhooks in the plan", () => {
  beforeEach(() => grant.missing.add("webhooks"));

  it("can still be switched off and deleted", async () => {
    expect(await toggleWebhook("e1", false)).toEqual({ ok: true });
    expect(h.hooks.setEndpointEnabled).toHaveBeenCalledWith("b1", "e1", false);
    expect(await deleteWebhook("e1")).toEqual({ ok: true });
    expect(h.hooks.deleteEndpoint).toHaveBeenCalledWith("b1", "e1");
  });

  it("cannot be switched on or edited", async () => {
    expect(await toggleWebhook("e1", true)).toEqual({ ok: false, error: NO_HOOKS });
    expect(await updateWebhook("e1", { url: "https://x.test/h", events: ["lead.created"] })).toEqual({ ok: false, error: NO_HOOKS });
    expect(h.hooks.setEndpointEnabled).not.toHaveBeenCalled();
    expect(h.hooks.updateEndpoint).not.toHaveBeenCalled();
  });
});
