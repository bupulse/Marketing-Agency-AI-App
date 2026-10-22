import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(),
  featureBlocked: vi.fn(),
  rateLimit: vi.fn(),
  revalidatePath: vi.fn(),
  prisma: { business: { findUnique: vi.fn() } },
  createProducts: vi.fn(),
  createPersona: vi.fn(),
  updatePersona: vi.fn(),
  createCompetitors: vi.fn(),
  savePositioning: vi.fn(),
  createFaqs: vi.fn(),
  savePolicies: vi.fn(),
  activateReadyDrafts: vi.fn(),
  linkPhotos: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock("@/lib/entitlements", () => ({ featureBlocked: mocks.featureBlocked }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/rate-limit")>()), rateLimit: mocks.rateLimit }));
vi.mock("@/lib/knowledge/service", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/knowledge/service")>()), createProducts: mocks.createProducts, activateReadyDrafts: mocks.activateReadyDrafts }));
vi.mock("@/lib/media/albums", () => ({ linkPhotos: mocks.linkPhotos }));
vi.mock("@/lib/brand/logo-from-gallery", () => ({ logoFromGalleryPhoto: vi.fn() }));
vi.mock("@/lib/storage", () => ({ createSignedDownloadUrl: vi.fn() }));
vi.mock("@/lib/knowledge/records", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/knowledge/records")>()),
  createPersona: mocks.createPersona,
  updatePersona: mocks.updatePersona,
  createCompetitors: mocks.createCompetitors,
  savePositioning: mocks.savePositioning,
  createFaqs: mocks.createFaqs,
  savePolicies: mocks.savePolicies,
}));
// The one-write rounds call their section's action; not under test here.
const single = vi.hoisted(() => ({ saveKnowledge: vi.fn(), saveLook: vi.fn(), approveVoice: vi.fn(), saveProfile: vi.fn(), createReview: vi.fn() }));
vi.mock("@/app/onboarding/actions", () => ({ saveKnowledge: single.saveKnowledge, saveLook: single.saveLook }));
vi.mock("@/app/dashboard/knowledge/interview/actions", () => ({ approveVoice: single.approveVoice }));
vi.mock("@/app/dashboard/knowledge/profile/actions", () => ({ saveProfile: single.saveProfile }));
vi.mock("@/app/dashboard/knowledge/reviews/actions", () => ({ createReview: single.createReview }));
vi.mock("@/lib/knowledge/quiz-ai", () => ({ draftBusinessQuiz: vi.fn() }));
vi.mock("@/lib/knowledge/overview", () => ({ knowledgeProgress: vi.fn() }));

import { saveQuizRound } from "@/app/dashboard/knowledge/quiz/actions";
import type { PersonaInput } from "@/lib/knowledge/audience";
import type { ProductInput } from "@/lib/knowledge/products";

// Placeholder business and items (fixtures use fake names).
const product = (name: string, patch: Partial<ProductInput> = {}): ProductInput => ({ kind: "PHYSICAL", name, summary: `${name}, fresh`, priceModel: "ON_REQUEST", price: "", currency: "RWF", usps: ["Made fresh"], features: [], status: "DRAFT", ...patch }) as ProductInput;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireActiveUser.mockResolvedValue({ id: "u1", role: "OWNER" });
  mocks.prisma.business.findUnique.mockResolvedValue({ id: "b1" });
  mocks.featureBlocked.mockResolvedValue(null);
  mocks.rateLimit.mockResolvedValue(undefined);
  mocks.createProducts.mockResolvedValue([{ id: "p1", name: "Passion Juice" }, { id: "p2", name: "Mango Juice" }]);
  mocks.createCompetitors.mockResolvedValue(["c1"]);
  mocks.createFaqs.mockResolvedValue(["f1", "f2"]);
  mocks.activateReadyDrafts.mockResolvedValue([]);
});

describe("saveQuizRound", () => {
  it("saves a round's products in one write, counts one rate-limit hit each, and revalidates nothing", async () => {
    const r = await saveQuizRound({ round: "sell", products: [product("Passion Juice"), product("Mango Juice", { priceModel: "FIXED", price: "1,500" })] });
    // The ids come back: each new product's photo question needs its album.
    expect(r).toEqual({ ok: true, products: [{ id: "p1", name: "Passion Juice" }, { id: "p2", name: "Mango Juice" }], activated: [] });
    expect(mocks.activateReadyDrafts).toHaveBeenCalledWith("b1");
    expect(mocks.requireActiveUser).toHaveBeenCalledWith("content", "throw");
    expect(mocks.featureBlocked).toHaveBeenCalledWith("b1", "content");
    expect(mocks.createProducts).toHaveBeenCalledTimes(1);
    expect(mocks.createProducts.mock.calls[0][1].map((p: { name: string; priceAmount: number | null }) => [p.name, p.priceAmount])).toEqual([["Passion Juice", null], ["Mango Juice", 1500]]);
    expect(mocks.rateLimit).toHaveBeenCalledTimes(2);
    expect(mocks.rateLimit).toHaveBeenCalledWith("projectCreate:u1", expect.anything());
    // Silent: a revalidation re-renders the (slow) quiz page inside the response. Other pages are dynamic.
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("checks every item first: the first failing one is named and nothing is written", async () => {
    const r = await saveQuizRound({ round: "sell", products: [product("Passion Juice"), product("Mango Juice", { usps: [] })] });
    expect(r).toMatchObject({ ok: false, item: 1, fieldErrors: { usps: "Add at least one reason to choose it." } });
    expect(mocks.createProducts).not.toHaveBeenCalled();
    expect(mocks.requireActiveUser).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("Rules need the settings permission and no plan feature; the FAQs go in one write with the policies", async () => {
    const r = await saveQuizRound({ round: "rules", policies: { paymentMethods: ["cash"], booking: "No booking needed: just walk in." }, faqs: [{ question: "Do you deliver?", answer: "Yes." }, { question: "Can I order a cake?", answer: "Yes." }] });
    expect(r).toEqual({ ok: true });
    expect(mocks.requireActiveUser).toHaveBeenCalledWith("settings", "throw");
    expect(mocks.featureBlocked).not.toHaveBeenCalled();
    expect(mocks.createFaqs).toHaveBeenCalledWith("b1", [{ question: "Do you deliver?", answer: "Yes." }, { question: "Can I order a cake?", answer: "Yes." }]);
    expect(mocks.savePolicies).toHaveBeenCalledWith("b1", expect.objectContaining({ paymentMethods: ["cash"], booking: "No booking needed: just walk in.", delivery: null }));
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("names the failing part: a question, or the positioning", async () => {
    expect(await saveQuizRound({ round: "rules", policies: null, faqs: [{ question: "Ok?", answer: "Yes." }, { question: "", answer: "x" }] })).toMatchObject({ ok: false, part: "faqs", item: 1 });
    expect(await saveQuizRound({ round: "why", competitors: [], positioning: { differentiators: ["x".repeat(200)], statement: "" } })).toMatchObject({ ok: false, part: "positioning" });
  });

  it("saves the personas side by side and returns their ids in order", async () => {
    mocks.updatePersona.mockResolvedValue(undefined);
    mocks.createPersona.mockResolvedValue("p9");
    const input: PersonaInput = { name: "Office worker", ageRange: "25-34", location: "Kigali", needs: ["Quick breakfast"] };
    const r = await saveQuizRound({ round: "customers", personas: [{ id: "p1", input }, { input: { ...input, name: "Student" } }] });
    expect(r).toEqual({ ok: true, ids: ["p1", "p9"] });
    expect(mocks.rateLimit).toHaveBeenCalledWith("knowledgeCreate:u1", expect.anything());
    expect(mocks.rateLimit).toHaveBeenCalledWith("knowledgeEdit:u1", expect.anything());
  });

  it("calls the one-write rounds' own actions quietly", async () => {
    for (const fn of Object.values(single)) fn.mockResolvedValue({ ok: true });
    const profile = { name: "Inzozi Bakery" } as never;
    await saveQuizRound({ round: "you", profile });
    await saveQuizRound({ round: "find", knowledge: { hours: "" } });
    await saveQuizRound({ round: "voice", summary: { voice: "Warm." }, answers: [] });
    await saveQuizRound({ round: "love", reviews: [{ quote: "Great", customerName: "A", source: "OTHER" }] });
    expect(single.saveProfile).toHaveBeenCalledWith(profile, { quiet: true });
    expect(single.saveKnowledge).toHaveBeenCalledWith({ hours: "" }, { quiet: true });
    expect(single.approveVoice).toHaveBeenCalledWith({ voice: "Warm." }, "quiz", [], { quiet: true });
    expect(single.createReview).toHaveBeenCalledWith(expect.objectContaining({ quote: "Great" }), { quiet: true });
  });

  it("Photos: links the gallery picks and makes the ready drafts active, in one request, naming them", async () => {
    mocks.activateReadyDrafts.mockResolvedValue(["Classic Manicure"]);
    const r = await saveQuizRound({ round: "photos", links: [{ productId: "p1", assetIds: ["m1", "m2"] }] });
    expect(r).toEqual({ ok: true, activated: ["Classic Manicure"] });
    expect(mocks.requireActiveUser).toHaveBeenCalledWith("content", "throw");
    expect(mocks.featureBlocked).toHaveBeenCalledWith("b1", "content");
    expect(mocks.linkPhotos).toHaveBeenCalledWith("b1", "product", "p1", ["m1", "m2"]);
    expect(mocks.activateReadyDrafts).toHaveBeenCalledWith("b1");
    // With no picks too: drafts made ready in an earlier visit or elsewhere still go live.
    expect(await saveQuizRound({ round: "photos", links: [] })).toEqual({ ok: true, activated: ["Classic Manicure"] });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(await saveQuizRound({ round: "photos", links: [{ productId: "p1", assetIds: [] }] })).toMatchObject({ ok: false });
  });

  it("Your look and Love notes go through their section actions, quietly; the failing review is named", async () => {
    single.saveLook.mockResolvedValue({ ok: true });
    await saveQuizRound({ round: "look", logoPath: "u1/logo/a.png", brandColors: ["#D63384"] });
    expect(single.saveLook).toHaveBeenCalledWith({ logoPath: "u1/logo/a.png", brandColors: ["#D63384"] }, { quiet: true });
    single.createReview.mockResolvedValueOnce({ ok: true, reviewId: "r1" }).mockResolvedValueOnce({ ok: false, error: "Check the highlighted fields.", fieldErrors: { customerName: "Add the customer's name or initials." } });
    const r = await saveQuizRound({ round: "love", reviews: [{ quote: "One", customerName: "A", source: "OTHER" }, { quote: "Two", customerName: "", source: "OTHER" }] });
    expect(r).toMatchObject({ ok: false, item: 1, fieldErrors: { customerName: expect.any(String) } });
    expect(single.createReview).toHaveBeenCalledTimes(2);
    expect(await saveQuizRound({ round: "love", reviews: Array.from({ length: 4 }, () => ({ quote: "x", customerName: "A", source: "OTHER" as const })) })).toMatchObject({ ok: false });
  });

  it("refuses an oversized batch", async () => {
    expect(await saveQuizRound({ round: "sell", products: Array.from({ length: 7 }, (_, i) => product(`P${i}`)) })).toMatchObject({ ok: false });
    expect(mocks.createProducts).not.toHaveBeenCalled();
  });
});
