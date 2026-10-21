import { describe, expect, it } from "vitest";
import { gapsInWords, profileGaps, readCreatorSignUp, readHandles, readProfileForm } from "@/lib/creators/profile-form";

// A creator's own account (lib/creators/profile-form.ts): the sign-up form, the profile form, and when a profile is
// complete enough to apply in one tap.

const form = (fields: Record<string, string>) => new Map(Object.entries(fields));

describe("readCreatorSignUp", () => {
  it("reads name, email, password and WhatsApp (Rwanda without a +)", () => {
    expect(readCreatorSignUp(form({ name: " Ana ", email: " Ana@Example.com ", password: "secret123", phone: "0791 954 277" }))).toEqual({
      ok: true,
      value: { name: "Ana", email: "ana@example.com", password: "secret123", phone: "+250791954277" },
    });
    expect(readCreatorSignUp(form({ name: "Ana", email: "a@example.com", password: "secret123", phone: "+254 712 345678" }))).toMatchObject({ ok: true, value: { phone: "+254712345678" } });
  });

  it("says what is wrong with each field", () => {
    const r = readCreatorSignUp(form({ name: "A", email: "nope", password: "short", phone: "12" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["email", "name", "password", "phone"]);
  });
});

describe("readProfileForm", () => {
  const ok = { name: "Ana Uwase", phone: "0791954277" };

  it("reads the profile: handles of any network with followers, up to three links, the switch", () => {
    const r = readProfileForm(form({ ...ok, location: " Kigali, Gasabo ", bio: "Food and fun.", handle_instagram: "@ana.rw", followers_instagram: "12k", handle_tiktok: "https://www.tiktok.com/@ana", followers_tiktok: "1.5M", sample_1: "https://www.instagram.com/p/abc/", discoverable: "on" }));
    expect(r).toEqual({
      ok: true,
      value: {
        name: "Ana Uwase",
        phone: "+250791954277",
        location: "Kigali, Gasabo",
        bio: "Food and fun.",
        handles: [
          { network: "instagram", handle: "ana.rw", followers: 12000 },
          { network: "tiktok", handle: "@ana", followers: 1_500_000 },
        ].map((h) => ({ ...h, handle: h.handle.replace(/^@/, "") })),
        samples: ["https://www.instagram.com/p/abc/"],
        discoverable: true,
      },
    });
    expect(readProfileForm(form(ok))).toMatchObject({ ok: true, value: { handles: [], samples: [], discoverable: false, location: null, bio: null } });
  });

  it("refuses a handle without followers, followers without a handle, bad links and a missing WhatsApp", () => {
    const r = readProfileForm(form({ name: "Ana", phone: "", handle_instagram: "ana", followers_facebook: "100", sample_2: "instagram.com/p/x", bio: "x".repeat(501) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["bio", "followers_instagram", "handle_facebook", "phone", "sample_2"]);
  });
});

describe("profileGaps", () => {
  const handles = [{ network: "instagram", handle: "ana", followers: 10 }];
  it("needs a WhatsApp number and a handle on one of the campaign's platforms", () => {
    expect(profileGaps({ phone: "+250791954277", handles }, ["instagram", "tiktok"])).toEqual([]);
    expect(profileGaps({ phone: null, handles }, ["instagram"])).toEqual(["phone"]);
    expect(profileGaps({ phone: "+250791954277", handles }, ["facebook"])).toEqual(["handle"]);
    expect(profileGaps({ phone: null, handles: "junk" }, ["facebook"])).toEqual(["phone", "handle"]);
    expect(gapsInWords(["phone", "handle"], ["instagram", "facebook", "tiktok"])).toBe("Add your WhatsApp number and your Instagram, Facebook or TikTok name and followers");
  });

  it("reads stored handles safely", () => {
    expect(readHandles([{ network: "instagram", handle: "a", followers: 1.7 }, { network: "myspace", handle: "b" }, null, { network: "tiktok", handle: "c", followers: "x" }])).toEqual([
      { network: "instagram", handle: "a", followers: 1 },
      { network: "tiktok", handle: "c", followers: 0 },
    ]);
  });
});
