import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The preview card on the demo screen (components/app/first-post-preview.tsx).
vi.mock("@/app/dashboard/first-post/actions", () => ({ makeFirstPostAction: vi.fn() }));

import { FirstPostPreview } from "@/components/app/first-post-preview";

const render = (props: Parameters<typeof FirstPostPreview>[0]) => renderToStaticMarkup(createElement(FirstPostPreview, props));

describe("first-post preview card", () => {
  it("offers the button to an owner before any preview", () => {
    const html = render({ initial: null, businessName: "Inzu Fashion", color: "#7b5cff", canMake: true });
    expect(html).toContain("See your first post now");
    expect(html).toContain("Make my first post");
  });

  it("tells a teammate who cannot make it who can", () => {
    const html = render({ initial: null, businessName: "Inzu Fashion", color: null, canMake: false });
    expect(html).not.toContain("Make my first post");
    expect(html).toContain("owner or an admin");
  });

  it("shows the post as a sample, with the business initials, and no button", () => {
    const html = render({ initial: { status: "ready", caption: "New kitenge in store.", hashtags: ["#Kigali"], headline: "Kitenge for you", canRetry: false }, businessName: "Inzu Fashion", color: "#ff0000", canMake: true });
    expect(html).toContain("Your first post, written by BuPulse");
    expect(html).toContain("New kitenge in store.");
    expect(html).toContain("#Kigali");
    expect(html).toContain(">IF<");
    expect(html).not.toContain("Make my first post");
  });

  it("offers Try again after a failed first try", () => {
    const html = render({ initial: { status: "failed", caption: null, hashtags: [], headline: null, canRetry: true }, businessName: "Inzu", color: null, canMake: true });
    expect(html).toContain("Try again");
  });
});
