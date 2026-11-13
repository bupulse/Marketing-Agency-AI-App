import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountAvatar } from "@/components/publishing/network-icon";

// Social account pictures: the network's picture while it loads (AvatarImage swaps to the initials when the signed CDN
// link has expired, QA 13 Nov), the initials when there is none.
describe("account avatar", () => {
  it("shows the network picture, without sending our address to the CDN", () => {
    const html = renderToStaticMarkup(createElement(AccountAvatar, { network: "instagram", name: "LEAF", src: "https://cdn.example.test/a.jpg" }));
    expect(html).toContain('src="https://cdn.example.test/a.jpg"');
    expect(html).toMatch(/referrerpolicy="no-referrer"/i);
  });

  it("shows the initial when there is no picture", () => {
    const html = renderToStaticMarkup(createElement(AccountAvatar, { network: "linkedin", name: "LinkedIn · Acme", src: null }));
    expect(html).not.toContain("<img");
    expect(html).toMatch(/>A<\/span>/);
  });
});
