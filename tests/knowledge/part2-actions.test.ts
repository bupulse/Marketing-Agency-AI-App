import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));

const role = vi.hoisted(() => ({ value: "MEMBER" as "OWNER" | "ADMIN" | "MEMBER" }));
const records = vi.hoisted(() => ({
  createFaq: vi.fn().mockResolvedValue("faq1"),
  updateFaq: vi.fn(),
  deleteListItem: vi.fn(),
  reorderList: vi.fn(),
  savePolicies: vi.fn(),
  createReview: vi.fn().mockResolvedValue("rev1"),
  updateReview: vi.fn(),
  setReviewPermission: vi.fn(),
  deleteReview: vi.fn(),
  createPersona: vi.fn().mockResolvedValue("p1"),
  updatePersona: vi.fn(),
  saveAudienceNotes: vi.fn(),
  createCompetitor: vi.fn().mockResolvedValue("c1"),
  updateCompetitor: vi.fn(),
  savePositioning: vi.fn(),
}));
const interview = vi.hoisted(() => ({ startInterview: vi.fn(), answerStep: vi.fn(), stepBack: vi.fn(), approveProfile: vi.fn(), updateApprovedProfile: vi.fn() }));
const rateLimitMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@/lib/db", () => ({ prisma: { business: { findUnique: vi.fn().mockResolvedValue({ id: "b1" }) } } }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/knowledge/records", () => records);
vi.mock("@/lib/knowledge/interview-service", () => interview);
vi.mock("@/lib/rate-limit", async () => ({ ...(await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit")), rateLimit: rateLimitMock }));
vi.mock("@/lib/auth/require-user", async () => {
  const { can, ForbiddenError } = await vi.importActual<typeof import("@/lib/team/roles")>("@/lib/team/roles");
  return {
    requireActiveUser: async (permission?: Parameters<typeof can>[1]) => {
      if (permission && !can(role.value, permission)) throw new ForbiddenError(permission);
      return { id: "u1", role: role.value };
    },
  };
});

import { createPersona } from "@/app/dashboard/knowledge/audience/actions";
import { createCompetitor } from "@/app/dashboard/knowledge/competitors/actions";
import { createFaq, reorderFaqs, savePolicies } from "@/app/dashboard/knowledge/faqs/actions";
import { answerQuestion, approveVoice, startInterview } from "@/app/dashboard/knowledge/interview/actions";
import { createReview } from "@/app/dashboard/knowledge/reviews/actions";
import { KnowledgeError } from "@/lib/knowledge/service";

beforeEach(() => {
  vi.clearAllMocks();
  role.value = "MEMBER";
});

describe("part 2 actions", () => {
  it("lets a Member add FAQs, personas, competitors and reviews (the content permission)", async () => {
    expect(await createFaq({ question: "Do you deliver?", answer: "Yes" })).toEqual({ ok: true, faqId: "faq1" });
    expect(records.createFaq).toHaveBeenCalledWith("b1", { question: "Do you deliver?", answer: "Yes" });
    expect((await createPersona({ name: "Student", ageRange: "18-24", location: "Huye" })).ok).toBe(true);
    expect((await createCompetitor({ name: "Rival", link: "rival.rw" })).ok).toBe(true);
    expect(records.createCompetitor.mock.calls[0][1]).toMatchObject({ link: "https://rival.rw" });
    expect((await createReview({ quote: "Great", customerName: "A.", source: "GOOGLE", canPublish: true })).ok).toBe(true);
    expect(records.createReview.mock.calls[0][1]).toMatchObject({ canPublish: true, receivedOn: null });
    expect(rateLimitMock).toHaveBeenCalledWith("knowledgeCreate:u1", expect.anything());
  });

  it("keeps policies and the brand voice to owners and admins (the settings permission)", async () => {
    expect(await savePolicies({ delivery: "Free" })).toMatchObject({ ok: false });
    expect(await startInterview()).toMatchObject({ ok: false });
    expect(await approveVoice({ voice: "Warm" })).toMatchObject({ ok: false });
    expect(records.savePolicies).not.toHaveBeenCalled();
    expect(interview.approveProfile).not.toHaveBeenCalled();

    role.value = "ADMIN";
    expect(await savePolicies({ delivery: "Free", paymentMethods: ["mtn_momo"] })).toEqual({ ok: true });
    expect(records.savePolicies).toHaveBeenCalledWith("b1", expect.objectContaining({ delivery: "Free", paymentMethods: ["mtn_momo"] }));
    expect(await approveVoice({ voice: "Warm", do: ["Short"], dont: [], samples: [] })).toEqual({ ok: true });
    expect(interview.approveProfile).toHaveBeenCalledWith("b1", { voice: "Warm", do: ["Short"], dont: [], samples: [] });
  });

  it("returns field errors before touching the database", async () => {
    const result = await createFaq({ question: "", answer: "" });
    expect(result).toMatchObject({ ok: false, fieldErrors: { question: "Write the question.", answer: "Write the answer." } });
    expect(records.createFaq).not.toHaveBeenCalled();
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(await createReview({ quote: "x", customerName: "A", source: "GOOGLE", receivedOn: future })).toMatchObject({ ok: false, fieldErrors: { receivedOn: expect.any(String) } });
    role.value = "OWNER";
    expect(await approveVoice({ voice: " " })).toMatchObject({ ok: false, fieldErrors: { voice: expect.any(String) } });
  });

  it("shows the service's own message (a stale order, a wrong answer) and refuses bad ids", async () => {
    records.reorderList.mockRejectedValueOnce(new KnowledgeError("The list changed in the meantime. Reload the page and try again."));
    expect(await reorderFaqs(["a", "b"])).toEqual({ ok: false, error: "The list changed in the meantime. Reload the page and try again." });
    expect(await reorderFaqs("nope" as never)).toEqual({ ok: false, error: "We could not change the order." });
    role.value = "OWNER";
    interview.answerStep.mockRejectedValueOnce(new KnowledgeError("Choose from the options shown."));
    expect(await answerQuestion({ index: 0, choices: ["x"] })).toEqual({ ok: false, error: "Choose from the options shown." });
    expect(await answerQuestion({ index: 99, choices: [] })).toMatchObject({ ok: false });
  });
});
