import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Posts' banners ("Connect your apps", "N posts were made as a reminder"): on a 390 px phone the words kept a 0 px
// basis, so the button stayed beside them and squeezed them to a word a line (QA 13 Nov). A 14rem basis wraps the
// button under the words instead.
const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");

describe("Posts banners on a phone", () => {
  it("give their words a minimum width so the button wraps under them", () => {
    expect(read("components/content-board/connect-apps-banner.tsx")).toContain('<div className="min-w-0 flex-1 basis-56">');
    expect(read("components/content-board/content-actions.tsx")).toContain('<p className="min-w-0 flex-1 basis-56 text-[15px]">');
  });
});
