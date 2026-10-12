import { describe, expect, it } from "vitest";
import { albumProblem, appendPositions, DESTINATION_REQUIRED, destinationOptions, destinationProblem, filterKey, parseDestination, parseFilter, uploadDestinationFor } from "@/lib/media/destinations";

describe("gallery destinations", () => {
  it("accepts a folder, a product album or a campaign album, and nothing else", () => {
    expect(parseDestination("folder:f1")).toEqual({ kind: "folder", id: "f1" });
    expect(parseDestination("product:cm1abc")).toEqual({ kind: "product", id: "cm1abc" });
    expect(parseDestination("campaign:c_2-x")).toEqual({ kind: "campaign", id: "c_2-x" });
    for (const raw of [null, undefined, "", "all", "none", "f1", "folder:", "album:x", "product:a:b", "product:../x", "product:a b", `folder:${"x".repeat(61)}`, 42]) {
      expect(parseDestination(raw)).toBeNull();
      expect(destinationProblem(raw)).toBe(DESTINATION_REQUIRED);
    }
    expect(destinationProblem("folder:f1")).toBeNull();
  });

  it("reads gallery views, including old folder links, and only uploads straight into a folder or album", () => {
    expect(parseFilter(undefined)).toEqual({ kind: "all" });
    expect(parseFilter("none")).toEqual({ kind: "none" });
    expect(parseFilter("f1")).toEqual({ kind: "folder", id: "f1" }); // ?folder=<id> links from before albums
    expect(parseFilter("product:p1")).toEqual({ kind: "product", id: "p1" });
    expect(parseFilter("weird:p1")).toEqual({ kind: "all" });
    expect(filterKey(parseFilter("campaign:k1"))).toBe("campaign:k1");
    expect(uploadDestinationFor({ kind: "all" })).toBeNull();
    expect(uploadDestinationFor({ kind: "none" })).toBeNull();
    expect(uploadDestinationFor({ kind: "product", id: "p1" })).toEqual({ kind: "product", id: "p1" });
  });

  it("caps an album at 30 photos and appends new ones in order", () => {
    expect(albumProblem(28, 2)).toBeNull();
    expect(albumProblem(29, 2)).toMatch(/up to 30 photos/);
    expect(appendPositions(3, 2)).toEqual([3, 4]);
  });

  it("lists destinations as folders, then products, then campaigns", () => {
    const options = destinationOptions({ folders: [{ id: "f1", name: "Shop" }], albums: [{ kind: "campaign", id: "k1", name: "Open day" }, { kind: "product", id: "p1", name: "Basket" }] });
    expect(options).toEqual([
      { key: "folder:f1", label: "Shop", group: "Folders" },
      { key: "product:p1", label: "Basket", group: "Products" },
      { key: "campaign:k1", label: "Open day", group: "Campaigns" },
    ]);
  });
});
