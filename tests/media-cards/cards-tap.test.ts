import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampaignCard } from "@/components/media-cards/campaign-card";
import { ProductCard } from "@/components/media-cards/product-card";

// The whole card opens it, photo included (QA 13 Nov: only the name, or the text under the photo, was a tap target).
describe("media cards open from anywhere on the card", () => {
  it("product card: no positioned box between the name's stretched link and the card", () => {
    const html = renderToStaticMarkup(createElement(ProductCard, { name: "Hydro Tower", href: "/dashboard/knowledge/products/p1", imageUrl: "https://example.test/p.jpg" }));
    expect(html).toContain('href="/dashboard/knowledge/products/p1"');
    // The text block under the photo holds the link: it must not be `relative`, or the link stops at it.
    const textBlock = html.match(/<div class="([^"]*flex-1 flex-col gap-1 p-4[^"]*)"/);
    expect(textBlock).not.toBeNull();
    expect(textBlock![1].split(" ")).not.toContain("relative");
  });

  it("campaign card: a pointer layer over the cover and facts opens the campaign, the name stays the keyboard link", () => {
    const html = renderToStaticMarkup(createElement(CampaignCard, { name: "Holiday views", href: "/dashboard/creators/c1", status: "live" }));
    const links = [...html.matchAll(/<a [^>]*href="\/dashboard\/creators\/c1"[^>]*>/g)].map((m) => m[0]);
    expect(links).toHaveLength(2);
    const layer = links.find((a) => a.includes('tabindex="-1"'));
    expect(layer).toBeDefined();
    expect(layer).toContain('aria-hidden="true"');
    expect(layer).toMatch(/absolute inset-0 z-\[1\]/);
  });

  it("campaign card with onOpen and no link: the layer calls it", () => {
    const html = renderToStaticMarkup(createElement(CampaignCard, { name: "Spring offer", onOpen: () => {}, status: "draft" }));
    expect(html).toMatch(/<span aria-hidden="true" class="absolute inset-0 z-\[1\] cursor-pointer/);
  });
});
