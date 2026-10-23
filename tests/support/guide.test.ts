import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { MAX_SECTION_CHARS, hashInput, planGuideSync, slugify, splitGuide, type HashedChunk } from "@/lib/support/guide-split";
import { searchTerms } from "@/lib/support/guide";

const DOC = `# Social connections (Channels)

Channels is where a business links its social accounts. See [the calendar](07-calendar.md) for **posting**.

**Page:** \`/dashboard/connections\`  **Plans:** Starter and Business.

## What you see

A card per network. ![screenshot](images/x.png)

## If something goes wrong

Reconnect the account.

## For developers

Set COMPOSIO_API_KEY in the environment.

## What you see

A second section with the same heading.

## Empty

`;

describe("splitting the guide", () => {
  const chunks = splitGuide("13-social-connections.md", DOC);

  it("reads the title and the page of the file", () => {
    expect(chunks.every((c) => c.title === "Social connections (Channels)" && c.page === "/dashboard/connections" && c.file === "13-social-connections.md")).toBe(true);
  });
  it("makes an Overview from the text before the first ## heading, then one section per heading", () => {
    expect(chunks.map((c) => c.heading)).toEqual(["Overview", "What you see", "If something goes wrong", "What you see"]);
    expect(chunks.map((c) => c.sort)).toEqual([0, 1, 2, 3]);
  });
  it("gives a repeated heading its own anchor", () => {
    expect(chunks.map((c) => c.anchor)).toEqual(["overview", "what-you-see", "if-something-goes-wrong", "what-you-see-2"]);
  });
  it("leaves out developer sections and empty ones", () => {
    expect(chunks.some((c) => /COMPOSIO|developers/i.test(c.body + c.heading))).toBe(false);
    expect(chunks.some((c) => c.heading === "Empty")).toBe(false);
  });
  it("turns markdown links into their text and drops images and bold marks", () => {
    expect(chunks[0].body).toContain("See the calendar for posting.");
    expect(chunks[0].body).not.toContain("](");
    expect(chunks[1].body).toBe("A card per network.");
  });
  it("cuts a very long section", () => {
    const long = splitGuide("01-x.md", `# X\n\n## Long\n\n${"word ".repeat(3000)}`);
    expect(long[0].body.length).toBe(MAX_SECTION_CHARS + 1);
    expect(long[0].body.endsWith("…")).toBe(true);
  });
  it("uses the file name without a title and no page without a Page line", () => {
    const [c] = splitGuide("02-y.md", "Some text");
    expect(c).toMatchObject({ title: "02-y", page: null, heading: "Overview", anchor: "overview" });
  });
  it("slugifies headings", () => {
    expect(slugify("Limits and settings (Posts → Settings)")).toBe("limits-and-settings-posts-settings");
    expect(slugify("***")).toBe("section");
  });
  it("hashes what matters: the body changes the hash input", () => {
    const [a] = splitGuide("01-x.md", "# X\n\n## A\n\none");
    const [b] = splitGuide("01-x.md", "# X\n\n## A\n\ntwo");
    expect(hashInput(a)).not.toBe(hashInput(b));
    expect(hashInput(a)).toBe(hashInput({ ...a }));
  });
});

describe("planning an index run", () => {
  const chunk = (anchor: string, hash: string, file = "01-x.md"): HashedChunk => ({ file, title: "X", page: null, heading: anchor, anchor, body: "b", sort: 0, hash });

  it("writes new and changed sections, skips unchanged ones and deletes what is gone", () => {
    const existing = [
      { id: "1", file: "01-x.md", anchor: "same", hash: "h1" },
      { id: "2", file: "01-x.md", anchor: "changed", hash: "old" },
      { id: "3", file: "01-x.md", anchor: "gone", hash: "h3" },
      { id: "4", file: "99-removed.md", anchor: "overview", hash: "h4" },
    ];
    const plan = planGuideSync(existing, [chunk("same", "h1"), chunk("changed", "new"), chunk("added", "h5")]);
    expect(plan.upserts.map((c) => c.anchor)).toEqual(["changed", "added"]);
    expect(plan.deletes).toEqual(["3", "4"]);
  });
  it("changes nothing the second time", () => {
    const chunks = [chunk("a", "h1"), chunk("b", "h2")];
    const existing = chunks.map((c, i) => ({ id: String(i), file: c.file, anchor: c.anchor, hash: c.hash }));
    expect(planGuideSync(existing, chunks)).toEqual({ upserts: [], deletes: [] });
  });
  it("tells the same anchor in two files apart", () => {
    const plan = planGuideSync([{ id: "1", file: "01-x.md", anchor: "overview", hash: "h" }], [chunk("overview", "h", "02-y.md")]);
    expect(plan.upserts).toHaveLength(1);
    expect(plan.deletes).toEqual(["1"]);
  });
});

describe("search words", () => {
  it("keeps letters and digits only, 3 characters or more, once each", () => {
    expect(searchTerms("My Instagram post failed!! Instagram? (it's urgent) & | !x")).toEqual(["instagram", "post", "failed", "urgent"]);
  });
  it("drops accents so French words still match", () => {
    expect(searchTerms("Réseaux sociaux connectés")).toEqual(["reseaux", "sociaux", "connectes"]);
  });
  it("never carries query syntax and stops at 16 words", () => {
    expect(searchTerms("a:* | b & !c <-> d")).toEqual([]);
    expect(searchTerms(Array.from({ length: 30 }, (_, i) => `word${i}`).join(" "))).toHaveLength(16);
  });
});
