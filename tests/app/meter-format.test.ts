import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Meter } from "@/components/ui/meter";

// Usage numbers run into the hundreds of thousands (voice characters): "1,500 / 200,000", not "1500 / 200000" (QA 13 Nov).
describe("Meter", () => {
  it("writes its numbers with thousands separators", () => {
    const html = renderToStaticMarkup(createElement(Meter, { value: 1500, max: 200000, label: "Voice characters", showValue: true }));
    expect(html).toContain("1,500 / 200,000");
    expect(html).toContain('aria-valuemax="200000"');
  });
});
