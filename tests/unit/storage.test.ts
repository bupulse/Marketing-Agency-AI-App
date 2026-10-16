import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => {
  const client = (who: string) => ({ storage: { from: (bucket: string) => ({ createSignedUploadUrl: async (path: string) => ({ data: { path, token: `${who}:${bucket}`, signedUrl: "u" }, error: null }) }) } });
  return { session: vi.fn(async () => client("session")), admin: vi.fn(() => client("service")) };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: h.session }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: h.admin }));

import { buildObjectPath, createSignedUploadUrl } from "@/lib/storage";

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

describe("createSignedUploadUrl", () => {
  it("uses the session (Storage policies apply) unless the caller asks for the service key", async () => {
    expect((await createSignedUploadUrl("media", "u1/a.png")).token).toBe("session:media");
    expect(h.admin).not.toHaveBeenCalled();
    expect((await createSignedUploadUrl("brand", "u1/logo/a.png", { service: true })).token).toBe("service:brand");
  });
});
