import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAt, jsonResponse, mockFetch } from "./helpers";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { toolError, viaComposio } from "@/lib/social/composio/client";
import { composioNetwork } from "@/lib/social/composio/networks";
import { getProvider } from "@/lib/social/registry";
import { SocialError, type ConnectionCredentials } from "@/lib/social/types";

const ok = (data: unknown) => jsonResponse({ data, successful: true, error: null });
const failed = (error: string) => jsonResponse({ data: {}, successful: false, error });
const body = (fn: ReturnType<typeof vi.fn>, i: number) => JSON.parse(callAt(fn, i).body ?? "{}");

const viaSocials = (network: "facebook" | "instagram" | "linkedin", externalAccountId: string, accountType: string): ConnectionCredentials => ({
  connectionId: "c1",
  externalAccountId,
  accountType,
  accessToken: "ca_123",
  method: "COMPOSIO",
  composioUserId: "biz1",
});

beforeEach(() => {
  process.env.COMPOSIO_API_KEY = "ak_test_key";
  delete process.env.SOCIALS_DIRECT;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.COMPOSIO_API_KEY;
});

describe("which networks go through BuPulse-Socials", () => {
  it("routes the Composio-managed networks while the key is set", () => {
    expect(viaComposio("facebook")).toBe(true);
    expect(viaComposio("instagram")).toBe(true);
    expect(viaComposio("linkedin")).toBe(true);
    expect(viaComposio("youtube")).toBe(true);
    expect(viaComposio("tiktok")).toBe(false);
  });

  it("sends networks listed in SOCIALS_DIRECT back to BuPulse's own apps", () => {
    process.env.SOCIALS_DIRECT = " Facebook, instagram ";
    expect(viaComposio("facebook")).toBe(false);
    expect(viaComposio("instagram")).toBe(false);
    expect(viaComposio("linkedin")).toBe(true);
  });

  it("routes nothing without the key", () => {
    delete process.env.COMPOSIO_API_KEY;
    expect(viaComposio("facebook")).toBe(false);
  });
});

describe("tool errors", () => {
  it("maps the network's message to what the publisher does", () => {
    expect(toolError("facebook", "(#190) Error validating access token: Session has expired").kind).toBe("auth");
    expect(toolError("instagram", "Application request limit reached (#4)").kind).toBe("rate_limit");
    expect(toolError("instagram", "(#100) Invalid parameter").kind).toBe("invalid");
    expect(toolError("facebook", "Something odd happened").kind).toBe("temporary");
  });
});

describe("publishing through BuPulse-Socials", () => {
  it("posts a Facebook photo with the Composio account and returns the post id and link", async () => {
    const fetch = mockFetch(ok({ id: "photo1", post_id: "111_222" }), ok({ permalink_url: "https://www.facebook.com/111/posts/222" }));
    const result = await getProvider("facebook").publish(viaSocials("facebook", "111", "page"), {
      format: "POST",
      text: "New phones in stock",
      media: [{ url: "https://storage.example/a.jpg?token=x", mimeType: "image/jpeg" }],
    });
    expect(result).toEqual({ externalId: "111_222", permalink: "https://www.facebook.com/111/posts/222" });
    expect(callAt(fetch, 0).url).toBe("https://backend.composio.dev/api/v3.1/tools/execute/FACEBOOK_CREATE_PHOTO_POST");
    expect(callAt(fetch, 0).headers["x-api-key"]).toBe("ak_test_key");
    expect(body(fetch, 0)).toEqual({ connected_account_id: "ca_123", user_id: "biz1", arguments: { page_id: "111", url: "https://storage.example/a.jpg?token=x", message: "New phones in stock", published: true } });
  });

  it("leaves direct accounts on BuPulse's own app", async () => {
    const fetch = mockFetch(jsonResponse({ id: "111_9" }), jsonResponse({ permalink_url: "https://www.facebook.com/111/posts/9" }));
    await getProvider("facebook").publish({ connectionId: "c2", externalAccountId: "111", accountType: "page", accessToken: "PAGE_TOKEN" }, { format: "POST", text: "Hi", media: [] });
    expect(callAt(fetch, 0).url).toContain("graph.facebook.com");
  });

  it("marks an expired sign-in for reconnecting, at the call that makes the post", async () => {
    mockFetch(failed("(#190) Error validating access token"));
    const error = await getProvider("facebook").publish(viaSocials("facebook", "111", "page"), { format: "POST", text: "Hi", media: [] }).catch((e) => e);
    expect(error).toBeInstanceOf(SocialError);
    expect(error.kind).toBe("auth");
  });

  it("makes an Instagram container, then publishes it, with hashtags kept", async () => {
    const fetch = mockFetch(ok({ id: "cont1" }), ok({ id: "media1" }), ok({ permalink: "https://www.instagram.com/p/abc/" }));
    const result = await getProvider("instagram").publish(viaSocials("instagram", "1784", "business"), {
      format: "POST",
      text: "Galaxy A56 #Kigali",
      media: [{ url: "https://storage.example/a.jpg", mimeType: "image/jpeg" }],
    });
    expect(result).toEqual({ externalId: "media1", permalink: "https://www.instagram.com/p/abc/" });
    expect(body(fetch, 0).arguments).toEqual({ ig_user_id: "1784", image_url: "https://storage.example/a.jpg", caption: "Galaxy A56 #Kigali" });
    expect(callAt(fetch, 1).url).toMatch(/INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH$/);
    expect(body(fetch, 1).arguments).toMatchObject({ ig_user_id: "1784", creation_id: "cont1" });
  });

  it("does not retry by itself when Instagram's publish step fails unclearly", async () => {
    mockFetch(ok({ id: "cont1" }), failed("Unexpected error"));
    const error = await getProvider("instagram").publish(viaSocials("instagram", "1784", "business"), { format: "POST", text: "x", media: [{ url: "https://s/a.jpg", mimeType: "image/jpeg" }] }).catch((e) => e);
    expect(error.kind).toBe("temporary");
    expect(error.stage).toBe("final");
  });

  it("rejects photos Instagram cannot take before calling anything", async () => {
    const fetch = mockFetch();
    const error = await getProvider("instagram").publish(viaSocials("instagram", "1784", "business"), { format: "POST", text: "x", media: [{ url: "https://s/a.png", mimeType: "image/png" }] }).catch((e) => e);
    expect(error.kind).toBe("invalid");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts LinkedIn text as the member, escaped for LinkedIn", async () => {
    const fetch = mockFetch(ok({ x_restli_id: "urn:li:share:7" }));
    const result = await getProvider("linkedin").publish(viaSocials("linkedin", "abc", "member"), { format: "POST", text: "Open (Mon-Sat) #Kigali", media: [] });
    expect(result.externalId).toBe("urn:li:share:7");
    expect(body(fetch, 0).arguments).toMatchObject({ author: "urn:li:person:abc", commentary: "Open \\(Mon-Sat\\) {hashtag|\\#|Kigali}", visibility: "PUBLIC", lifecycleState: "PUBLISHED" });
  });
});

describe("listing accounts after sign-in", () => {
  it("lists the Facebook Pages of the sign-in", async () => {
    mockFetch(ok({ data: [{ id: "111", name: "Nova Phones", picture: { data: { url: "https://x/p.jpg" } } }, { id: "222", name: "Nova Repairs" }] }));
    const accounts = await composioNetwork("facebook").accounts("ca_1", "biz1");
    expect(accounts).toEqual([
      { externalAccountId: "111", displayName: "Nova Phones", avatarUrl: "https://x/p.jpg", accountType: "page" },
      { externalAccountId: "222", displayName: "Nova Repairs", avatarUrl: undefined, accountType: "page" },
    ]);
  });

  it("offers the LinkedIn member and the Pages they administer", async () => {
    mockFetch(ok({ sub: "abc", name: "Diane U." }), ok({ elements: [{ organization: "urn:li:organization:42", role: "ADMINISTRATOR" }] }));
    const accounts = await composioNetwork("linkedin").accounts("ca_1", "biz1");
    expect(accounts.map((a) => [a.externalAccountId, a.accountType])).toEqual([
      ["abc", "member"],
      ["42", "organization"],
    ]);
  });

  it("takes Instagram professional accounts only", async () => {
    mockFetch(ok({ user_id: "1784", username: "novaphones", account_type: "BUSINESS" }));
    expect((await composioNetwork("instagram").accounts("ca_1", "biz1"))[0]).toMatchObject({ externalAccountId: "1784", displayName: "@novaphones", accountType: "business" });
    mockFetch(ok({ user_id: "99", username: "me.personal", account_type: "PERSONAL" }));
    await expect(composioNetwork("instagram").accounts("ca_1", "biz1")).rejects.toThrow(/professional/);
  });

  it("says so when the sign-in has no Facebook Page", async () => {
    mockFetch(ok({ data: [] }));
    await expect(composioNetwork("facebook").accounts("ca_1", "biz1")).rejects.toThrow(/No Facebook Pages/);
  });
});
