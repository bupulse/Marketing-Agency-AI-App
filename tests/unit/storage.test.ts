import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { buildObjectPath } from "@/lib/storage";

describe("buildObjectPath", () => {
  it("starts with the user id and sanitises the file name", () => {
    const path = buildObjectPath("user-1", "My Photo (1).PNG", "Spring Sale");
    expect(path).toMatch(
      /^user-1\/spring-sale\/[0-9a-f-]{36}-my-photo-1-.png$/,
    );
  });

  it("works without a folder and never escapes the user folder", () => {
    const path = buildObjectPath("user-1", "../../etc/passwd");
    expect(path.startsWith("user-1/")).toBe(true);
    expect(path.split("/")).toHaveLength(2);
  });
});
