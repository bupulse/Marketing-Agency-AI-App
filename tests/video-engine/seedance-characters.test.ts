import { createHash, createHmac } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_CHARACTERS, characterReference, clearCharacterCache, listCharacters, parseListAssets, parsePicks, previewCardSvg, previewPortraitPng, signAssetsRequest } from "@/lib/video-engine/seedance-characters";
import { planSeedanceShots } from "@/lib/video-engine/seedance-brain";

// The response example of the ModelArk ListAssets page (17 October 2026), with a second item of each kind we skip.
const DOC_EXAMPLE = {
  ResponseMetadata: { RequestId: "20260328000000000000000000000000", Action: "ListAssets", Version: "2024-01-01", Service: "ark", Region: "ap-southeast-1" },
  Result: {
    Items: [
      { Id: "Asset-20260328-aaaaa", Name: "test", URL: "https://example.com/asset-url", GroupId: "group-2026-x", AssetType: "Image", Status: "Active", ProjectName: "default", CreateTime: "2026-03-28T00:00:00Z" },
      { Id: "Asset-20260328-bbbbb", Name: "still processing", AssetType: "Image", Status: "Processing" },
      { Id: "Asset-20260328-ccccc", Name: "a voice", AssetType: "Audio", Status: "Active" },
    ],
    NextToken: "next-1",
  },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => clearCharacterCache());

describe("reading BytePlus's answers", () => {
  it("ListAssets: active images become characters with their asset:// reference", () => {
    const out = parseListAssets(DOC_EXAMPLE);
    expect(out.nextToken).toBe("next-1");
    expect(out.characters).toEqual([{ id: "Asset-20260328-aaaaa", name: "test", description: "Digital character from the BytePlus library", uri: "asset://Asset-20260328-aaaaa", portraitUrl: "https://example.com/asset-url", source: "byteplus" }]);
    expect(parseListAssets({ Result: { Items: [] } })).toEqual({ characters: [], nextToken: null });
  });

  it("an error answer is explained in plain words", () => {
    expect(() => parseListAssets({ ResponseMetadata: { Error: { Code: "SignatureDoesNotMatch", Message: "..." } } })).toThrow(/did not accept the Access Key/);
    expect(() => parseListAssets({ ResponseMetadata: { Error: { Code: "InternalError" } } })).toThrow(/could not list the characters \(InternalError\)/);
  });

  it("the owner's picks: ids from the Playground, asset:// optional, names kept", () => {
    const picks = parsePicks(JSON.stringify([{ id: "asset://asset-111", name: "Amani", description: "warm" }, { id: "asset-222" }, { name: "no id" }]));
    expect(picks.map((c) => [c.id, c.name, c.uri, c.source])).toEqual([["asset-111", "Amani", "asset://asset-111", "picked"], ["asset-222", "asset-222", "asset://asset-222", "picked"]]);
    expect(() => parsePicks("{oops")).toThrow(/not valid JSON/);
  });
});

describe("signing a ModelArk management call", () => {
  it("follows the documented steps: canonical request, scope, key chain, HMAC-SHA256", () => {
    const body = JSON.stringify({ Filter: { GroupType: "AIGC" } });
    const date = new Date("2026-03-28T00:00:00Z");
    const out = signAssetsRequest({ accessKeyId: "AKTEST", secretAccessKey: "SKTEST", action: "ListAssets", body, date });
    expect(out.url).toBe("https://ark.ap-southeast-1.byteplusapi.com/?Action=ListAssets&Version=2024-01-01");
    expect(out.headers["X-Date"]).toBe("20260328T000000Z");
    // Recomputed here from the documentation's PHP sample, step by step.
    const hash = createHash("sha256").update(body).digest("hex");
    expect(out.headers["X-Content-Sha256"]).toBe(hash);
    const canonical = ["POST", "/", "Action=ListAssets&Version=2024-01-01", "content-type:application/json", "host:ark.ap-southeast-1.byteplusapi.com", `x-content-sha256:${hash}`, "x-date:20260328T000000Z", "", "content-type;host;x-content-sha256;x-date", hash].join("\n");
    const toSign = ["HMAC-SHA256", "20260328T000000Z", "20260328/ap-southeast-1/ark/request", createHash("sha256").update(canonical).digest("hex")].join("\n");
    const h = (k: string | Buffer, s: string) => createHmac("sha256", k).update(s).digest();
    const key = h(h(h(h("SKTEST", "20260328"), "ap-southeast-1"), "ark"), "request");
    const signature = createHmac("sha256", key).update(toSign).digest("hex");
    expect(out.headers.Authorization).toBe(`HMAC-SHA256 Credential=AKTEST/20260328/ap-southeast-1/ark/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=${signature}`);
    // Another body, another signature.
    expect(signAssetsRequest({ accessKeyId: "AKTEST", secretAccessKey: "SKTEST", action: "ListAssets", body: "{}", date }).headers.Authorization).not.toBe(out.headers.Authorization);
  });
});

describe("listing characters", () => {
  it("no Seedance key: six preview characters with drawn portraits", async () => {
    const list = await listCharacters({ env: {}, picksFile: "/nonexistent/picks.json" });
    expect(list.source).toBe("preview");
    expect(list.characters).toHaveLength(6);
    expect(list.characters.every((c) => c.source === "preview" && c.portraitUrl === `/api/seedance/characters/${c.id}/portrait.png`)).toBe(true);
    expect(list.notice).toMatch(/arrive with the key/);
    const png = await previewPortraitPng("preview-amani");
    const meta = await sharp(png as Buffer).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 400, 500]);
    expect(previewCardSvg("preview-kalisa")).toContain("Kalisa");
    expect(await previewPortraitPng("nobody")).toBeNull();
    expect(new Set(PREVIEW_CHARACTERS.map((c) => c.name)).size).toBe(6);
  }, 30_000); // sharp loads its fonts on the first SVG

  it("with the key but nothing set up: none, and what to do", async () => {
    const list = await listCharacters({ env: { SEEDANCE_API_KEY: "k" }, picksFile: "/nonexistent/picks.json" });
    expect(list).toMatchObject({ source: "none", characters: [] });
    expect(list.notice).toMatch(/Digital Character Library.*seedance-characters\.json/);
  });

  it("the owner's picks first, then the account's own (two pages), no duplicates, cached 30 minutes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chars-"));
    const picks = path.join(dir, "picks.json");
    await fs.writeFile(picks, JSON.stringify([{ id: "Asset-20260328-aaaaa", name: "Amani" }]));
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { NextToken?: string; Filter: { GroupType: string } };
      expect(body.Filter.GroupType).toBe("AIGC");
      expect((init.headers as Record<string, string>).Authorization).toMatch(/^HMAC-SHA256 Credential=AK\//);
      return body.NextToken ? json({ Result: { Items: [{ Id: "Asset-2", Name: "Kalisa", AssetType: "Image", Status: "Active", URL: "https://x/2.png" }] } }) : json(DOC_EXAMPLE);
    });
    const env = { SEEDANCE_API_KEY: "k", BYTEPLUS_ACCESS_KEY_ID: "AK", BYTEPLUS_SECRET_ACCESS_KEY: "SK" };
    const now = Date.parse("2026-10-17T08:00:00Z");
    const list = await listCharacters({ env, fetchImpl: fetchImpl as unknown as typeof fetch, picksFile: picks, now });
    expect(list.source).toBe("picked");
    expect(list.characters.map((c) => [c.id, c.name, c.source])).toEqual([["Asset-20260328-aaaaa", "Amani", "picked"], ["Asset-2", "Kalisa", "byteplus"]]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await listCharacters({ env, fetchImpl: fetchImpl as unknown as typeof fetch, picksFile: picks, now: now + 10 * 60_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await listCharacters({ env, fetchImpl: fetchImpl as unknown as typeof fetch, picksFile: picks, now: now + 31 * 60_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("a refused Access Key keeps the picks and says why", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chars-"));
    const picks = path.join(dir, "picks.json");
    await fs.writeFile(picks, JSON.stringify([{ id: "asset-9", name: "Nadia" }]));
    const refused = vi.fn(async () => json({ ResponseMetadata: { Error: { Code: "InvalidAccessKey" } } }, 401));
    const list = await listCharacters({ env: { SEEDANCE_API_KEY: "k", BYTEPLUS_ACCESS_KEY_ID: "AK", BYTEPLUS_SECRET_ACCESS_KEY: "SK" }, fetchImpl: refused as unknown as typeof fetch, picksFile: picks });
    expect(list.characters.map((c) => c.name)).toEqual(["Nadia"]);
    expect(list.notice).toMatch(/did not accept the Access Key/);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("a character as a presenter", () => {
  it("gives the asset:// reference, the label and the prompt line; previews are refused", () => {
    const ref = characterReference({ id: "Asset-2", name: "Kalisa", source: "byteplus" }, 2);
    expect(ref.reference).toEqual({ kind: "image", url: "asset://Asset-2", role: "reference_image" });
    expect(ref.label).toBe("Kalisa (digital character, presenter)");
    expect(ref.promptLine).toBe("The presenter is Kalisa, the digital character from Image 2: keep the same face, hair and build in every shot.");
    expect(() => characterReference({ id: "preview-amani", name: "Amani", source: "preview" }, 1)).toThrow(/preview character/);
  });

  it("the shot planner uses the character as the presenter, with no face warning", () => {
    const plan = planSeedanceShots({ business: { name: "Nova Phones Kigali", language: "English" }, product: { name: "Galaxy A56" }, references: ["Image 1: the phone", "Image 2: Kalisa (digital character, presenter)"], templateId: "phone-ugc-review", seconds: 10 });
    expect(plan.prompt).toContain("the presenter from Image 2");
    expect(plan.notes.join(" ")).not.toMatch(/real-looking faces/);
  });
});
