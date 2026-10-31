import { describe, expect, it } from "vitest";
import { accountName, askWhereToPost, bareName, choiceTag, noLinkedInPage, orderChoices, pagesFirst, preselectedChoices } from "@/lib/social/choices";
import { completePages, imageUrn, logosFromImages, pageChoice, pagesFromAcls, pagesFromLookup } from "@/lib/social/providers/linkedin/pages";
import type { AccountChoice } from "@/lib/social/types";

// Placeholder Pages and links: no real LinkedIn data.
const LOGO_100 = "https://media.licdn.com/dms/image/v2/placeholder/company-logo_100_100/0/1?e=1&v=beta&t=x";
const LOGO_200 = "https://media.licdn.com/dms/image/v2/placeholder/company-logo_200_200/0/1?e=1&v=beta&t=x";
const LOGO_400 = "https://media.licdn.com/dms/image/v2/placeholder/company-logo_400_400/0/1?e=1&v=beta&t=x";

const still = (width: number, url: string) => ({
  artifact: `urn:li:digitalmediaMediaArtifact:(urn:li:digitalmediaAsset:C4D0AAA,urn:li:digitalmediaMediaArtifactClass:company-logo_${width}_${width})`,
  data: { "com.linkedin.digitalmedia.mediaartifact.StillImage": { displaySize: { width, height: width, uom: "PX" }, storageSize: { width, height: width } } },
  identifiers: [{ identifier: url, identifierType: "EXTERNAL_URL", mediaType: "image/png", file: "urn:li:digitalmediaFile:x" }],
});

/** organizationAcls with projection=(elements*(*,organization~(localizedName,logoV2(original~:playableStreams)))). */
const projected = {
  paging: { count: 50, start: 0, links: [] },
  elements: [
    {
      role: "ADMINISTRATOR",
      state: "APPROVED",
      roleAssignee: "urn:li:person:abc",
      organization: "urn:li:organization:1001",
      "organization~": {
        localizedName: "Sample Bakery Ltd",
        logoV2: { original: "urn:li:digitalmediaAsset:C4D0AAA", "original~": { elements: [still(100, LOGO_100), still(200, LOGO_200), still(400, LOGO_400)] } },
      },
    },
    { role: "ADMINISTRATOR", state: "APPROVED", roleAssignee: "urn:li:person:abc", organization: "urn:li:organization:1002", "organization~": { localizedName: "Sample Shop" } },
  ],
};

/** organizationAcls without a projection: ids only. */
const plain = {
  paging: { count: 50, start: 0, total: 2 },
  elements: [
    { role: "ADMINISTRATOR", state: "APPROVED", roleAssignee: "urn:li:person:abc", organization: "urn:li:organization:1001", lastModified: { actor: "urn:li:person:abc", time: 1 } },
    { role: "ADMINISTRATOR", state: "APPROVED", roleAssignee: "urn:li:person:abc", organizationalTarget: "urn:li:organization:1002" },
  ],
};

/** GET /rest/organizations?ids=List(1001,1002) */
const lookup = {
  results: {
    "1001": { id: 1001, localizedName: "Sample Bakery Ltd", vanityName: "sample-bakery", name: { localized: { en_US: "Sample Bakery Ltd" }, preferredLocale: { country: "US", language: "en" } }, logoV2: { cropped: "urn:li:digitalmediaAsset:C4D0AAA", original: "urn:li:digitalmediaAsset:C4D0BBB" } },
    "1002": { id: 1002, name: { localized: { fr_FR: "Boutique Exemple" } } },
  },
  statuses: { "1001": 200, "1002": 200 },
  errors: {},
};

describe("LinkedIn Pages from an access list", () => {
  it("reads names and the nearest-200px logo from a projected answer", () => {
    expect(pagesFromAcls(projected)).toEqual([
      { id: "1001", name: "Sample Bakery Ltd", logoUrl: LOGO_200, logoUrn: "urn:li:image:C4D0AAA" },
      { id: "1002", name: "Sample Shop", logoUrl: undefined, logoUrn: undefined },
    ]);
  });

  it("reads ids only from a plain answer (organization and the older organizationalTarget)", () => {
    expect(pagesFromAcls(plain).map((p) => [p.id, p.name])).toEqual([
      ["1001", undefined],
      ["1002", undefined],
    ]);
  });

  it("finds the Pages inside Composio's wrappers and in JSON text", () => {
    expect(pagesFromAcls({ response_data: projected }).map((p) => p.name)).toEqual(["Sample Bakery Ltd", "Sample Shop"]);
    expect(pagesFromAcls(JSON.stringify(plain)).map((p) => p.id)).toEqual(["1001", "1002"]);
    expect(pagesFromAcls({ data: { organizations: [{ id: 1003, localizedName: "Sample Salon" }] } })).toEqual([{ id: "1003", name: "Sample Salon", logoUrl: undefined, logoUrn: undefined }]);
  });

  it("lists nothing when the member runs no Page", () => {
    expect(pagesFromAcls({ elements: [] })).toEqual([]);
    expect(pagesFromAcls(null)).toEqual([]);
  });
});

describe("names and logos from the lookups", () => {
  it("names the Pages from the organizations batch get, a localized name when there is no localizedName", () => {
    const found = pagesFromLookup(lookup);
    expect(found.get("1001")).toMatchObject({ name: "Sample Bakery Ltd", logoUrn: "urn:li:image:C4D0AAA" });
    expect(found.get("1002")).toMatchObject({ name: "Boutique Exemple", logoUrn: undefined });
  });

  it("turns logo URNs into links with the images batch get", () => {
    const logos = logosFromImages({ results: { "urn:li:image:C4D0AAA": { id: "urn:li:image:C4D0AAA", downloadUrl: LOGO_200, status: "AVAILABLE" } } });
    expect(logos.get("urn:li:image:C4D0AAA")).toBe(LOGO_200);
    expect(logosFromImages({ data: [{ id: "urn:li:image:C4D0AAA", downloadUrl: LOGO_100 }] }).get("urn:li:image:C4D0AAA")).toBe(LOGO_100);
    expect(imageUrn("urn:li:digitalmediaAsset:C4D0AAA")).toBe("urn:li:image:C4D0AAA");
    expect(imageUrn("urn:li:organization:1")).toBeUndefined();
  });

  it("fills in only what the access list lacked", () => {
    const pages = completePages(pagesFromAcls(plain), pagesFromLookup(lookup), new Map([["urn:li:image:C4D0AAA", LOGO_200]]));
    expect(pages.map(pageChoice)).toEqual([
      { externalAccountId: "1001", displayName: "Sample Bakery Ltd", avatarUrl: LOGO_200, accountType: "organization" },
      { externalAccountId: "1002", displayName: "Boutique Exemple", avatarUrl: undefined, accountType: "organization" },
    ]);
  });

  it("falls back to LinkedIn Page and the number only when no name came back", () => {
    expect(pageChoice({ id: "1004" })).toEqual({ externalAccountId: "1004", displayName: "LinkedIn Page 1004", avatarUrl: undefined, accountType: "organization" });
  });
});

const profile: AccountChoice = { externalAccountId: "abc", displayName: "Placeholder Person", accountType: "member" };
const page = (id: string, name = `Sample Page ${id}`): AccountChoice => ({ externalAccountId: id, displayName: name, accountType: "organization" });

describe("Where should BuPulse post?", () => {
  it("lists the Pages first, then the profile", () => {
    expect(orderChoices("linkedin", [profile, page("1"), page("2")]).map((a) => a.externalAccountId)).toEqual(["1", "2", "abc"]);
    // Other networks keep their order.
    const fb = [page("9"), page("8")].map((a) => ({ ...a, accountType: "page" }));
    expect(orderChoices("facebook", fb).map((a) => a.externalAccountId)).toEqual(["9", "8"]);
  });

  it("ticks the only Page, not the profile next to it", () => {
    expect(preselectedChoices("linkedin", [profile, page("1")])).toEqual(["1"]);
  });

  it("ticks nothing when there are several Pages, and the only account when there is one", () => {
    expect(preselectedChoices("linkedin", [profile, page("1"), page("2")])).toEqual([]);
    expect(preselectedChoices("linkedin", [profile])).toEqual(["abc"]);
    expect(preselectedChoices("facebook", [{ ...page("1"), accountType: "page" }, { ...page("2"), accountType: "page" }])).toEqual([]);
  });

  it("tags Pages and the profile", () => {
    expect(choiceTag("linkedin", "organization")).toBe("Company Page");
    expect(choiceTag("linkedin", "member")).toBe("Your profile");
    expect(choiceTag("facebook", "page")).toBeNull();
  });

  it("always asks on LinkedIn, even with only the profile, and explains a missing Page", () => {
    expect(askWhereToPost("linkedin", [profile])).toBe(true);
    expect(noLinkedInPage("linkedin", [profile])).toBe(true);
    expect(noLinkedInPage("linkedin", [profile, page("1")])).toBe(false);
    expect(askWhereToPost("instagram", [{ ...profile, accountType: "business" }])).toBe(false);
    expect(askWhereToPost("facebook", [page("1"), page("2")])).toBe(true);
  });
});

describe("naming and choosing LinkedIn Pages after connecting", () => {
  it("names a Page LinkedIn · <Page name> and leaves profiles and other networks alone", () => {
    expect(accountName("linkedin", "LinkedIn", "Sample Bakery Ltd", "organization")).toBe("LinkedIn · Sample Bakery Ltd");
    expect(accountName("linkedin", "LinkedIn", "Placeholder Person", "member")).toBe("Placeholder Person");
    expect(accountName("facebook", "Facebook", "Sample Bakery", "page")).toBe("Sample Bakery");
    expect(accountName("linkedin", "LinkedIn", null, "organization")).toBe("LinkedIn");
    expect(bareName("LinkedIn · Sample Bakery Ltd", "LinkedIn")).toBe("Sample Bakery Ltd");
  });

  it("puts a LinkedIn Page before the profile, the other networks where they were", () => {
    const rows = [
      { id: "fb", provider: "facebook", accountType: "page" },
      { id: "me", provider: "linkedin", accountType: "member" },
      { id: "ig", provider: "instagram", accountType: "business" },
      { id: "pg", provider: "linkedin", accountType: "organization" },
    ];
    expect(pagesFirst(rows).map((r) => r.id)).toEqual(["fb", "pg", "ig", "me"]);
    // The first LinkedIn account is now the Page: what daily posts and by-hand switching take.
    expect(pagesFirst(rows).find((r) => r.provider === "linkedin")?.id).toBe("pg");
  });
});
