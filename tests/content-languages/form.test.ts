import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/dashboard/content/actions", () => ({ saveContentLanguagesAction: vi.fn() }));
vi.mock("@/components/ui", async () => {
  const { createElement: h } = await import("react");
  return {
    Button: (p: { children: unknown }) => h("button", null, p.children as never),
    GlassCard: (p: { children: unknown }) => h("section", null, p.children as never),
    useToast: () => ({ toast: vi.fn() }),
  };
});

import { LanguagesForm } from "@/components/content-board/languages-form";
import { defaultContentLanguages } from "@/lib/content-languages/settings";

const html = (props: Partial<Parameters<typeof LanguagesForm>[0]> = {}) =>
  renderToStaticMarkup(createElement(LanguagesForm, { initial: defaultContentLanguages({ country: "Rwanda" }), noVoice: ["Kinyarwanda", "Swahili"], canEdit: true, askText: "Ask an Owner.", ...props }));

describe("the Languages card", () => {
  it("has the three parts, each with one language or a mix", () => {
    const out = html();
    for (const title of ["Pictures and captions", "Daily videos", "Talking skits"]) expect(out).toContain(title);
    expect(out.match(/Mix of languages/g)).toHaveLength(3);
    expect(out).toContain("One post is never in two languages.");
  });

  it("says honestly when the daily videos' language has no voice yet, only under the videos", () => {
    const out = html();
    expect(out.match(/BuPulse has no Kinyarwanda voice yet/g)).toHaveLength(1);
    expect(html({ noVoice: ["Swahili"] })).not.toContain("no Kinyarwanda voice yet");
    expect(html({ initial: { ...defaultContentLanguages({}), videos: { mode: "mix", languages: ["English", "Swahili"] } } })).toContain("BuPulse has no Swahili voice yet");
  });

  it("is read-only for a Member", () => {
    const out = html({ canEdit: false });
    expect(out).toContain("Ask an Owner.");
    expect(out).not.toContain("Save languages");
  });
});
