import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "@/app/(marketing)/privacy/page";

// Meta App Review reads the privacy policy (docs/META_APP_REVIEW.md): it must say how Facebook and Instagram data is
// deleted, describe every permission the app asks for (comments and messages included) and open at /privacy#deletion.
describe("privacy page for Meta App Review", () => {
  const html = renderToStaticMarkup(createElement(PrivacyPage));

  it("has the deletion anchor and links the data deletion page", () => {
    expect(html).toContain('id="deletion"');
    expect(html).toContain('href="/data-deletion"');
    expect(html).toMatch(/Data from Facebook and Instagram/);
    expect(html).toMatch(/confirmation code/);
  });

  it("describes comments and messages instead of promising never to comment or message", () => {
    expect(html).toMatch(/Answer comments and messages/);
    expect(html).toMatch(/direct messages people send it/);
    expect(html).not.toMatch(/unless you ask us to publish something/);
  });

  it("mentions trending sounds and shows its own update date", () => {
    expect(html).toMatch(/Trending sounds on Instagram reels/);
    expect(html).toContain("Last updated: 13 November 2026");
  });
});
