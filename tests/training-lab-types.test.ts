import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINES, ENGINES, KINDS, MAX_FILE_BYTES, exampleInputProblem, exampleInputSchema, fileProblem } from "@/lib/training-lab/types";
import { examplePath, exampleFolder, isExamplePath, safeFileName, TRAINING_BUCKET } from "@/lib/training-lab/storage";

const reel = {
  kind: "reel",
  title: "  Kigali car seller  ",
  hasFile: true,
  howMade: "Phone clips, cut on every beat.",
  whatIsGood: "The hook in the first second.",
};

describe("exampleInputSchema", () => {
  it("accepts a reel with a file and fills the defaults", () => {
    const v = exampleInputSchema.parse(reel);
    expect(v.title).toBe("Kigali car seller");
    expect(v).toMatchObject({ sourceUrl: null, neverThis: null, notes: null, rating: null, tags: [], technique: [], engines: [], consentGiven: false });
  });

  it("cleans tags and techniques and drops repeated engines", () => {
    const v = exampleInputSchema.parse({ ...reel, tags: ["Car Sellers", "car  sellers", " "], technique: ["Beat Sync"], engines: ["reel", "video", "reel"] });
    expect(v.tags).toEqual(["car sellers"]);
    expect(v.technique).toEqual(["beat sync"]);
    expect(v.engines).toEqual(["reel", "video"]);
  });

  it("explains each problem in plain words", () => {
    expect(exampleInputProblem({ ...reel, kind: "song" })).toBe("Choose what kind of example this is.");
    expect(exampleInputProblem({ ...reel, title: "  " })).toBe("Give the example a title.");
    expect(exampleInputProblem({ ...reel, howMade: "" })).toBe("Say how it was made, in your own words.");
    expect(exampleInputProblem({ ...reel, whatIsGood: "" })).toBe("Say what is good about it.");
    expect(exampleInputProblem({ ...reel, rating: 6 })).toBe("Rate it from 1 to 5 stars.");
    expect(exampleInputProblem({ ...reel, rating: 2.5 })).toBe("Rate it from 1 to 5 stars.");
    expect(exampleInputProblem({ ...reel, engines: ["tiktok"] })).toBe("That engine does not exist.");
    expect(exampleInputProblem({ ...reel, title: "x".repeat(121) })).toBe("Keep the title under 120 letters.");
    expect(exampleInputProblem(reel)).toBeNull();
  });

  it("needs a file or a link, except for a posting habit", () => {
    expect(exampleInputProblem({ ...reel, hasFile: false })).toBe("Add a file or a link to the example.");
    expect(exampleInputProblem({ ...reel, hasFile: false, sourceUrl: "www.tiktok.com/x" })).toBe("Use a full link starting with https://");
    expect(exampleInputProblem({ ...reel, hasFile: false, sourceUrl: "https://www.tiktok.com/@a/video/1" })).toBeNull();
    expect(exampleInputProblem({ ...reel, kind: "schedule", hasFile: false, schedule: { hours: "7, 19" } })).toBeNull();
  });

  it("needs what is said for a recording, and consent with a name for an actor", () => {
    expect(exampleInputProblem({ ...reel, kind: "voice" })).toBe("Write what is said in the recording.");
    expect(exampleInputProblem({ ...reel, kind: "voice", transcript: "Muraho neza" })).toBeNull();
    expect(exampleInputProblem({ ...reel, kind: "actor" })).toBe("Only add an actor who agreed to be used: tick the consent box.");
    expect(exampleInputProblem({ ...reel, kind: "actor", consentGiven: true })).toBe("Write the name of the person who agreed.");
    expect(exampleInputProblem({ ...reel, kind: "actor", consentGiven: true, consentName: "Actor One" })).toBeNull();
  });

  it("has default engines that exist for every kind", () => {
    for (const kind of KINDS) for (const e of DEFAULT_ENGINES[kind]) expect(ENGINES).toContain(e);
  });
});

describe("fileProblem", () => {
  it("takes the right file for each kind", () => {
    expect(fileProblem({ name: "a.mp4", type: "video/mp4", size: 1000 }, "reel")).toBeNull();
    expect(fileProblem({ name: "a.jpg", type: "image/jpeg", size: 1000 }, "reel")).toBe("a.jpg is not a video. A reel needs a video.");
    expect(fileProblem({ name: "a.m4a", type: "audio/x-m4a", size: 1000 }, "voice")).toBeNull();
    expect(fileProblem({ name: "a.png", type: "image/png", size: 1000 }, "actor")).toBeNull();
    expect(fileProblem({ name: "a.pdf", type: "application/pdf", size: 1000 }, "image")).toContain("is not a photo or image");
  });

  it("refuses empty and too large files", () => {
    expect(fileProblem({ name: "a.mp4", type: "video/mp4", size: 0 }, "video")).toBe("a.mp4 is empty.");
    expect(fileProblem({ name: "a.mp4", type: "video/mp4", size: MAX_FILE_BYTES + 1 }, "video")).toBe("a.mp4 is over 100 MB.");
  });
});

describe("storage paths", () => {
  const admin = "0b6f3c1e-1111-4222-8333-444455556666";
  const example = "cmh4example0001";

  it("uses its own private bucket", () => {
    expect(TRAINING_BUCKET).toBe("training-lab");
  });

  it("makes safe file names", () => {
    expect(safeFileName("Kigali Car Seller (final).MP4")).toBe("kigali-car-seller-final.mp4");
    expect(safeFileName("Umuhanzi wé.m4a")).toBe("umuhanzi-we.m4a");
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("..\\..\\secret.txt")).toBe("secret.txt");
    expect(safeFileName("...")).toBe("file");
    expect(safeFileName("")).toBe("file");
    const long = safeFileName(`${"a".repeat(200)}.mp4`);
    expect(long.length).toBe(80);
    expect(long.endsWith(".mp4")).toBe(true);
  });

  it("puts a file in the example's folder under the admin", () => {
    expect(examplePath(admin, example, "My Reel.mp4")).toBe(`${admin}/${example}/my-reel.mp4`);
    expect(() => exampleFolder("../x", example)).toThrow();
    expect(() => exampleFolder(admin, "a/b")).toThrow();
    expect(() => exampleFolder(admin, "")).toThrow();
  });

  it("checks that a path is a file in that folder", () => {
    expect(isExamplePath(`${admin}/${example}/my-reel.mp4`, admin, example)).toBe(true);
    expect(isExamplePath(`${admin}/other/my-reel.mp4`, admin, example)).toBe(false);
    expect(isExamplePath(`${admin}/${example}/`, admin, example)).toBe(false);
    expect(isExamplePath(`${admin}/${example}/../x/a.mp4`, admin, example)).toBe(false);
    expect(isExamplePath(`${admin}/${example}/sub/a.mp4`, admin, example)).toBe(false);
    expect(isExamplePath(`${admin}/${example}/a.mp4`, "../x", example)).toBe(false);
  });
});

describe("a schedule example", () => {
  const base = { kind: "schedule", title: "Facebook in Kigali", howMade: "From Insights.", whatIsGood: "Evenings work." };
  it("turns the form's fields into notes", () => {
    const v = exampleInputSchema.parse({ ...base, schedule: { network: "facebook", country: "Rwanda", hours: "7, 12:30, 19h", weekdays: [1, 3], postsPerWeek: "5", formats: ["reel"] } });
    expect(v.notes).toEqual({ network: "facebook", country: "Rwanda", hours: [7, 12, 19], weekdays: [1, 3], postsPerWeek: 5, formats: ["reel"] });
  });
  it("takes all networks and days only", () => {
    expect(exampleInputSchema.parse({ ...base, schedule: { network: "", hours: "", weekdays: [5] } }).notes).toEqual({ weekdays: [5] });
  });
  it("asks for at least one hour or one day, and explains unreadable parts", () => {
    expect(exampleInputProblem({ ...base, schedule: { network: "facebook" } })).toBe("Give at least one hour or one day.");
    expect(exampleInputProblem(base)).toBe("Give at least one hour or one day.");
    expect(exampleInputProblem({ ...base, schedule: { hours: "after lunch" } })).toBe("We could not read the hours. Write them like 7, 12:30, 19h.");
    expect(exampleInputProblem({ ...base, schedule: { network: "myspace", hours: "7" } })).toBe("Choose a network from the list.");
    expect(exampleInputProblem({ ...base, schedule: { hours: "7", postsPerWeek: "99" } })).toMatch(/Posts per week/);
  });
  it("leaves other kinds' notes alone", () => {
    expect(exampleInputSchema.parse(reel).notes).toBeNull();
    expect(exampleInputSchema.parse({ ...reel, notes: { hook: "x" } }).notes).toEqual({ hook: "x" });
  });
});
