import { describe, expect, it } from "vitest";
import { initialValues } from "@/components/brand-profile/initial";
import { emptyLocation, knowledgeInput, type LocationValue } from "@/components/brand-profile/steps";
import { readKnowledge, validateKnowledge } from "@/lib/brand/schemas";
import { isBuildingResult, locationText, mapsUrl, shortAddress, summarizeLocations } from "@/lib/business-info/locations";

const head = (patch: Partial<LocationValue>): LocationValue => ({ ...emptyLocation("head"), ...patch });
const save = (locations: LocationValue[]) => validateKnowledge({ faqs: [], locations });

describe("display", () => {
  it("puts the building details before the street, without the country", () => {
    const l = { address: "KN 4 Avenue, Kigali, Rwanda", building: { name: "M Peace Plaza", floor: "3rd floor", block: "Block B", unit: "Shop 12" } };
    expect(locationText(l)).toBe("M Peace Plaza, 3rd floor, Block B, Shop 12 — KN 4 Avenue, Kigali");
    expect(locationText({ address: "KG 7 Ave, Kigali, Rwanda" })).toBe("KG 7 Ave, Kigali");
    expect(shortAddress("Kigali")).toBe("Kigali");
  });
  it("does not repeat a building name Google already put in the address", () => {
    expect(locationText({ address: "Kigali Heights, KG 7 Avenue, Kigali, Rwanda", building: { name: "Kigali Heights", floor: "2nd floor" } })).toBe("Kigali Heights, 2nd floor — KG 7 Avenue, Kigali");
  });
  it("reads locations saved before building details", () => {
    const k = readKnowledge({ faqs: [], locations: [{ kind: "head", address: "KG 7 Ave, Kigali", placeId: "ChIJabcdefghij" }] });
    expect(summarizeLocations(k.locations)).toEqual(["Head office: KG 7 Ave, Kigali (map: https://www.google.com/maps/search/?api=1&query=KG+7+Ave%2C+Kigali&query_place_id=ChIJabcdefghij)"]);
    expect(initialValues({ description: null, audience: null, tone: null, logoUrl: null, brandColors: [], knowledge: k }).locations[0]).toMatchObject({ address: "KG 7 Ave, Kigali", inBuilding: false, manual: false });
  });
  it("knows which Google results are buildings", () => {
    expect(isBuildingResult(["establishment", "point_of_interest"])).toBe(true);
    expect(isBuildingResult(["premise"])).toBe(true);
    expect(isBuildingResult(["route", "geocode"])).toBe(false);
    expect(isBuildingResult(undefined)).toBe(false);
  });
});

describe("inside a building", () => {
  it("needs the building name when ticked and keeps the optional parts", () => {
    const missing = save([head({ address: "KN 4 Avenue, Kigali", inBuilding: true, building: { name: " ", floor: "3rd floor", block: "", unit: "" } })]);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors["locations.0.buildingName"]).toMatch(/building or mall name/);

    const ok = save([head({ address: "KN 4 Avenue, Kigali", placeId: "ChIJ_m_peace_plaza", inBuilding: true, building: { name: "M Peace Plaza", floor: "3", block: "", unit: "Shop 12" } })]);
    expect(ok.ok && ok.data.locations?.[0].building).toEqual({ name: "M Peace Plaza", floor: "3", unit: "Shop 12" });
  });
  it("ignores the building fields when the box is not ticked", () => {
    const r = save([head({ address: "KN 4 Avenue", inBuilding: false, building: { name: "Old name", floor: "1", block: "", unit: "" } })]);
    expect(r.ok && r.data.locations?.[0].building).toBeUndefined();
  });
  it("limits the lengths", () => {
    const r = save([head({ address: "KN 4", inBuilding: true, building: { name: "x".repeat(121), floor: "f".repeat(41), block: "b".repeat(41), unit: "u".repeat(41) } })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["locations.0.block", "locations.0.buildingName", "locations.0.floor", "locations.0.unit"]);
  });
});

describe("entered by hand", () => {
  it("joins street, area and city, drops any place id and links a Maps search of the text", () => {
    const r = save([head({ manual: true, street: "KN 4 Ave", area: "Kiyovu", city: "Kigali", placeId: "ChIJ_forged_place", lat: 1, lng: 2, inBuilding: true, building: { name: "M Peace Plaza", floor: "3", block: "", unit: "" } })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const l = r.data.locations![0];
    expect(l).toMatchObject({ address: "KN 4 Ave, Kiyovu, Kigali", manual: { street: "KN 4 Ave", area: "Kiyovu", city: "Kigali" } });
    expect(l.placeId).toBeUndefined();
    expect(l.lat).toBeUndefined();
    expect(l.mapsUrl).toBe("https://www.google.com/maps/search/?api=1&query=M+Peace+Plaza%2C+KN+4+Ave%2C+Kiyovu%2C+Kigali");
    expect(locationText(l)).toBe("M Peace Plaza, 3rd floor — KN 4 Ave, Kiyovu, Kigali");
  });
  it("needs at least one part, and round-trips to the form", () => {
    const r = save([head({ manual: true, inBuilding: true, building: { name: "M Peace Plaza", floor: "", block: "", unit: "" } })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["locations.0.street"]).toMatch(/street, the area or the city/);

    const saved = save([head({ manual: true, area: "Kiyovu", city: "Kigali" })]);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const form = initialValues({ description: null, audience: null, tone: null, logoUrl: null, brandColors: [], knowledge: saved.data });
    expect(form.locations[0]).toMatchObject({ manual: true, street: "", area: "Kiyovu", city: "Kigali" });
    expect(validateKnowledge(knowledgeInput(form))).toEqual(saved);
  });
  it("builds a search link from coordinates only as a last resort", () => {
    expect(mapsUrl({ address: "", lat: -1.95, lng: 30.06 })).toBe("https://www.google.com/maps/search/?api=1&query=-1.95%2C30.06");
  });
});

describe("chat prompt", () => {
  it("tells visitors the building, floor and shop number with the map link", async () => {
    const { businessFactsContext } = await import("@/lib/business-info/facts");
    const k = readKnowledge({ faqs: [], locations: [{ kind: "head", label: "Shop", address: "KN 4 Avenue, Kigali, Rwanda", placeId: "ChIJ_m_peace_plaza", building: { name: "M Peace Plaza", floor: "3rd floor", block: "Block B", unit: "Shop 12" } }] });
    const text = businessFactsContext(k)!;
    expect(text).toContain("- Shop: M Peace Plaza, 3rd floor, Block B, Shop 12 — KN 4 Avenue, Kigali (map: https://www.google.com/maps/search/?api=1&query=KN+4+Avenue%2C+Kigali%2C+Rwanda&query_place_id=ChIJ_m_peace_plaza)");
    expect(text).toMatch(/building, floor, block and shop number first/);
  });
});

describe("floor dropdown, block and shop number labels", () => {
  it("lists basements to rooftop with English ordinals", async () => {
    const { FLOORS, ordinal } = await import("@/lib/business-info/locations");
    expect(FLOORS.slice(0, 5).map((f) => f.label)).toEqual(["Basement 2", "Basement 1", "Ground floor", "Mezzanine", "1st floor"]);
    expect(FLOORS.at(-1)).toEqual({ value: "R", label: "Rooftop" });
    expect(FLOORS.at(-2)).toEqual({ value: "60", label: "60th floor" });
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31, 42, 53].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st", "42nd", "53rd"]);
  });
  it("shows floor, block and number with their words", async () => {
    const { blockLabel, buildingText, floorLabel } = await import("@/lib/business-info/locations");
    expect(["8", "G", "B1", "B2", "M", "R"].map(floorLabel)).toEqual(["8th floor", "Ground floor", "Basement 1", "Basement 2", "Mezzanine", "Rooftop"]);
    expect(floorLabel("Top deck")).toBe("Top deck"); // older free text, as typed
    expect(["B", "b", "C2", "Block B", "East wing"].map(blockLabel)).toEqual(["Block B", "Block B", "Block C2", "Block B", "East wing"]);
    // The shop or office number is shown exactly as typed.
    for (const unit of ["Shop 12", "Office 4A", "12"]) expect(buildingText({ name: "Plaza", unit })).toBe(`Plaza, ${unit}`);
    expect(locationText({ address: "KN 4 Ave, Kigali, Rwanda", building: { name: "M Peace Plaza", floor: "8", block: "B", unit: "Shop 12" } })).toBe("M Peace Plaza, 8th floor, Block B, Shop 12 — KN 4 Ave, Kigali");
  });
  it("maps floors typed before the dropdown, and keeps the rest as typed", async () => {
    const { parseFloor } = await import("@/lib/business-info/locations");
    expect(["8", "8th", "8th floor", "Floor 8", "level 8", "ground", "Ground floor", "GF", "0", "basement", "Basement 2", "B1", "mezzanine", "Rooftop", "roof"].map(parseFloor)).toEqual(["8", "8", "8", "8", "8", "G", "G", "G", "G", "B1", "B2", "B1", "M", "R", "R"]);
    expect(parseFloor("Top deck")).toBeNull();
    expect(parseFloor("99th floor")).toBeNull();
    const k = readKnowledge({ faqs: [], locations: [{ kind: "head", address: "KN 4 Ave", building: { name: "Plaza", floor: "8th floor" } }, { kind: "branch", address: "X", building: { name: "Mall", floor: "Top deck" } }] });
    expect(k.locations.map((l) => l.building?.floor)).toEqual(["8", "Top deck"]);
  });
  it("only accepts floors from the list, plus older free text already saved", () => {
    const at = (floor: string, legacyFloors?: string[]) => validateKnowledge({ faqs: [], locations: [head({ address: "KN 4 Ave", inBuilding: true, building: { name: "Plaza", floor, block: "", unit: "" } })] }, { legacyFloors });
    expect(at("8").ok).toBe(true);
    expect(at("R").ok).toBe(true);
    const bad = at("8th floor");
    expect(!bad.ok && bad.errors["locations.0.floor"]).toMatch(/from the list/);
    expect(at("Top deck", ["Top deck"]).ok).toBe(true);
  });
});
