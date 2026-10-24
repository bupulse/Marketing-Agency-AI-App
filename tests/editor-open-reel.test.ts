import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  job: { value: null as null | Record<string, unknown> },
  view: vi.fn(async () => ({ id: "reel1", title: "Grow at home", language: "Kinyarwanda", clips: [], musicUrl: null })),
  me: { value: { isOwner: true, staffId: null as string | null } },
}));

vi.mock("@/lib/db", () => ({ prisma: { reelJob: { findFirst: vi.fn(async () => h.job.value), findMany: vi.fn(async () => []) } } }));
vi.mock("@/lib/reel-engine/engine", () => ({ reelView: h.view, reelContact: async () => "0788 000 000" }));
vi.mock("@/lib/admin/auth", () => ({ requirePermission: async () => h.me.value, requireAdmin: async () => h.me.value }));
vi.mock("@/lib/admin/console", () => ({ adminAction: vi.fn(), actionMessage: vi.fn(), finish: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/admin/training-lab/editor" }));
vi.mock("@/app/admin/(console)/(ai)/training-lab/actions", () => ({ createExampleAction: vi.fn(), confirmExampleFileAction: vi.fn() }));
vi.mock("@/app/admin/(console)/(ai)/training-lab/editor/actions", () => ({ openReelAction: vi.fn() }));

const { reelLab, openFinishedReel } = await import("@/app/admin/(console)/(ai)/training-lab/editor/reels");
const { LabNotes } = await import("@/components/editor/lab-notes");
const { SpecEditor } = await import("@/components/editor/spec-editor");
const { default: EditorPage } = await import("@/app/admin/(console)/(ai)/training-lab/editor/page");

const plan = {
  title: "Grow at home",
  labExampleIds: ["e1", "e2", "e3"],
  labSpellingFixes: [{ where: "line 2", from: "murakaza nez", to: "murakaza neza" }, { where: "title" }],
  languageIssues: [{ where: "caption", found: "x", message: "“Mwiriwe” is the evening greeting; it is morning here.", suggestion: null }, { message: "" }],
  labAvoid: ["Never: the presenter walks through the product."],
};
const job = { id: "reel1", businessId: "b1", plan, business: { userId: "u1", name: "LEAF", brandColors: ["#123456"] } };

/** Every element in a server component's returned tree (it is not rendered, only walked). */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  return [node, ...elements(props.children)];
}

beforeEach(() => {
  h.job.value = job;
  h.me.value = { isOwner: true, staffId: null };
  h.view.mockClear();
});

describe("what the Lab did to a reel", () => {
  it("reads the plan's Lab notes, leaving out what is malformed", () => {
    expect(reelLab(plan)).toEqual({
      examplesRead: 3,
      fixes: [{ where: "line 2", from: "murakaza nez", to: "murakaza neza" }],
      issues: ["“Mwiriwe” is the evening greeting; it is morning here."],
      avoid: ["Never: the presenter walks through the product."],
    });
    expect(reelLab(null)).toEqual({ examplesRead: 0, fixes: [], issues: [], avoid: [] });
    expect(reelLab({ labExampleIds: "x", labAvoid: [1, "Never: blur."] })).toEqual({ examplesRead: 0, fixes: [], issues: [], avoid: ["Never: blur."] });
  });

  it("shows them read-only and collapsed", () => {
    const html = renderToStaticMarkup(createElement(LabNotes, { lab: reelLab(plan) }));
    expect(html).toMatch(/^<details[^>]*>/);
    expect(html).not.toContain("<details open");
    expect(html).toContain("Lab examples read");
    expect(html).toContain("line 2: murakaza nez → murakaza neza");
    expect(html).toContain("Mwiriwe");
    expect(html).toContain("Never: the presenter walks through the product.");
    expect(html).not.toMatch(/<(input|textarea|button)/);
    expect(renderToStaticMarkup(createElement(LabNotes, { lab: reelLab({}) }))).toContain("Nothing: it was made before the Lab");
  });

  it("comes with the opened reel", async () => {
    const opened = await openFinishedReel("reel1");
    expect(opened?.lab.examplesRead).toBe(3);
    expect(opened?.brand).toEqual({ name: "LEAF", color: "#123456", contact: "0788 000 000" });
  });
});

describe("the editor page with ?reel=<id>", () => {
  it("opens that finished reel, with fresh links", async () => {
    const tree = await EditorPage({ searchParams: Promise.resolve({ reel: "reel1" }), params: Promise.resolve({}) } as never);
    const editor = elements(tree).find((e) => e.type === SpecEditor)!;
    expect((editor.props as { initialReel: { view: { id: string } } | null }).initialReel?.view.id).toBe("reel1");
    expect(h.view).toHaveBeenCalledWith({ userId: "u1", businessId: "b1" }, "reel1");
  });

  it("shows a plain message and the example for an unknown or unfinished reel", async () => {
    h.job.value = null;
    const tree = await EditorPage({ searchParams: Promise.resolve({ reel: "nope" }), params: Promise.resolve({}) } as never);
    const all = elements(tree);
    expect((all.find((e) => e.type === SpecEditor)!.props as { initialReel: unknown }).initialReel).toBeNull();
    expect(all.some((e) => (e.props as { children?: unknown }).children === "That reel is not finished or is gone, so the example is open instead.")).toBe(true);
  });

  it("opens the example without a reel, and stays hidden from anyone but the owner", async () => {
    const tree = await EditorPage({ searchParams: Promise.resolve({}), params: Promise.resolve({}) } as never);
    expect((elements(tree).find((e) => e.type === SpecEditor)!.props as { initialReel: unknown }).initialReel).toBeNull();
    h.me.value = { isOwner: true, staffId: "s1" };
    await expect(EditorPage({ searchParams: Promise.resolve({ reel: "reel1" }), params: Promise.resolve({}) } as never)).rejects.toThrow("NOT_FOUND");
  });
});
