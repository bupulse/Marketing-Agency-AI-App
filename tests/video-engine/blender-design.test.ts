// Premium 3D design (docs/BLENDER.md): Claude writes a Blender scene from the brief. Claude is mocked here.
import { describe, expect, it } from "vitest";
import { BLENDER_LOOK_NAMES, TEMPLATE_LOOKS, blenderBriefText, blenderSystemPrompt, designBlenderScene, fillFrame, fitLayout, fixSpelling, lookForTemplate, phoneLabel, stage, textHeight, textWidth, wrapInTwo } from "@/lib/video-engine/blender-design";
import { DesignError, type ClaudeTransport, type DesignBrief } from "@/lib/video-engine/designer";
import { normalizeBlenderScene } from "@/tools/blender/scene";
import { VIDEO_TEMPLATES } from "@/lib/video-engine/templates";

const brief: DesignBrief = {
  business: { name: "Nova Phones Kigali", language: "English", colors: ["#0b5fff", "#f4b400"], phone: "+250 788 300 400" },
  product: { name: "Samsung Galaxy A56", summary: "5G, 256 GB, in Kibagabaga", price: "420,000 RWF", usps: ["Genuine with 12-month warranty"] },
  photos: [
    { base64: "AAAA", mediaType: "image/jpeg", width: 1024, height: 1024 },
    { base64: "BBBB", mediaType: "image/jpeg", width: 800, height: 1200, cutout: true },
  ],
  styleId: "3d-title-drop",
  hookId: "auto",
  ratio: "9:16",
  seconds: 6,
};

const usage = { model: "claude-sonnet-5-5", inputTokens: 18000, outputTokens: 1700, costUsd: 0.08, apiEquivalentUsd: 0.08 };
const answer = (o: unknown, stop: string | null = "end_turn") => ({ text: typeof o === "string" ? o : "```json\n" + JSON.stringify(o) + "\n```", usage, stop });

const good = {
  version: 1,
  canvas: { ratio: "9:16", quality: "540p", fps: 24 },
  duration: 6,
  background: { kind: "studio", colors: ["#05070d", "#0b5fff"] },
  camera: { move: "orbitRight", intensity: 0.4, target: [0, 0, 2.2], distance: 9.5, height: 1.6, lens: 50 },
  product: { photo: 2, height: 2.6, position: [0, 0, 0.9], enter: "rise", idle: "turntable" },
  texts: [
    { text: "GALAXY A56", font: "anton", size: 0.7, position: [0, -0.3, 4.15], material: "metal", color: "#f4b400", enterAt: 0.4 },
    { text: "420,000 RWF", font: "anton", size: 0.5, position: [0, -1, 0.45], material: "gloss", color: "#ffffff", enterAt: 1 },
  ],
  caption: "Samsung Galaxy A56 at Nova Phones Kigali, 420,000 RWF.",
  hashtags: ["#kigali", "samsung"],
  say: "Galaxy A56, 420,000 francs at Nova Phones.",
};

function mock(...answers: ReturnType<typeof answer>[]): { send: ClaudeTransport; calls: Parameters<ClaudeTransport>[0][] } {
  const calls: Parameters<ClaudeTransport>[0][] = [];
  const send: ClaudeTransport = async (call) => {
    calls.push(call);
    const next = answers.shift();
    if (!next) throw new Error("no more answers");
    return next;
  };
  return { send, calls };
}

describe("designBlenderScene", () => {
  it("makes a checked scene, the caption and the voice line from one call", async () => {
    const { send, calls } = mock(answer(good));
    const photos = [{ image: "/c/a.jpg" }, { image: "/c/b.jpg", cutout: "/c/b.png" }];
    const d = await designBlenderScene(brief, send, "claude-sonnet-5-5", { photos });
    expect(calls).toHaveLength(1);
    expect(calls[0].system).toContain('"orbitRight"');
    expect(calls[0].system).toMatch(/never "turntable" or "spin"/);
    expect(calls[0].content.filter((c) => (c as { type: string }).type === "image")).toHaveLength(2);
    expect(d.attempts).toBe(1);
    expect(d.scene.product).toMatchObject({ photo: 2, image: "/c/b.jpg", cutout: "/c/b.png" });
    expect(d.scene.duration).toBe(6);
    expect(d.caption).toMatch(/Nova Phones/);
    expect(d.hashtags).toEqual(["kigali", "samsung"]);
    expect(d.say).toMatch(/francs/);
    expect(d.costUsd).toBe(0.08);
    expect(d.factWarnings).toEqual([]);
    // A photo is flat: the turntable becomes a swing.
    expect(d.scene.product?.idle).toBe("swing");
    expect(d.warnings.join(" ")).toMatch(/swing/);
    // The scene renders again with the same photo list (renderBlenderScene checks it once more).
    expect(normalizeBlenderScene(d.scene, { photos }).scene.product?.image).toBe("/c/b.jpg");
  });

  it("asks again, with the problem, when the answer is unusable", async () => {
    const { send, calls } = mock(answer("Here is my idea, no JSON"), answer({ ...good, product: { photo: 7 } }), answer(good));
    await expect(designBlenderScene(brief, send)).rejects.toThrow(DesignError);
    expect(calls).toHaveLength(2);
    const retry = calls[1].content.at(-1) as { text: string };
    expect(retry.text).toMatch(/could not be used: .*JSON/);
  });

  it("explains a missing product on the retry and succeeds", async () => {
    const { send, calls } = mock(answer({ ...good, product: { photo: 9 } }), answer(good));
    const d = await designBlenderScene(brief, send);
    expect(d.attempts).toBe(2);
    expect(d.usage).toHaveLength(2);
    expect((calls[1].content.at(-1) as { text: string }).text).toMatch(/"photo": n \} with n from 1 to 2/);
    expect(d.scene.product?.image).toBe("photo:2");
    expect(d.scene.product?.cutout).toBe("photo:2:cutout");
  });

  it("stops on a refusal and keeps the usage", async () => {
    const { send } = mock(answer("I can't help", "refusal"));
    const error = await designBlenderScene(brief, send).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DesignError);
    expect((error as DesignError).usage).toHaveLength(1);
  });

  it("reports invented facts and fixes spelling, line breaks, length and chrome", async () => {
    const texts = [
      { text: "50% OFF\nTODAY", size: 0.5, position: [0, -0.3, 4.3], material: "chrome" },
      { text: "KIBAGABARA", size: 0.3, position: [0, -0.3, 5] },
    ];
    const { send } = mock(answer({ ...good, duration: 12, texts, caption: "Best price in town" }));
    const d = await designBlenderScene(brief, send);
    expect(d.scene.duration).toBe(6);
    expect(d.scene.texts[0].text).toBe("50% OFF TODAY");
    expect(d.scene.texts[0].material).toBe("gloss");
    expect(d.scene.texts[1].text).toBe("KIBAGABAGA");
    expect(d.scene.texts[1].size).toBeGreaterThanOrEqual(0.6);
    const found = d.factWarnings.map((w) => w.found);
    expect(found).toContain("50%");
    expect(found).toContain("best");
  });

  it("writes the phone number the way the brief does", async () => {
    const { send } = mock(answer({ ...good, texts: [...good.texts, { text: "+250788300400", size: 0.5, position: [0, -0.3, 5] }] }));
    const d = await designBlenderScene(brief, send);
    expect(d.scene.texts.map((t) => t.text)).toContain("Call +250 788 300 400");
  });

  it("holds the end still: entrances finish by 60 % of the clip", async () => {
    const late = { ...good, texts: [{ ...good.texts[0], enterAt: 5, enterFor: 0.9 }] };
    const { send } = mock(answer(late));
    const d = await designBlenderScene(brief, send);
    const t = d.scene.texts[0];
    expect(t.enterAt + t.enterFor).toBeLessThanOrEqual(6 * 0.6 + 1e-9);
  });

  it("tells Claude the frame size, the length and the photos", () => {
    const text = blenderBriefText({ ...brief, seconds: 20 });
    expect(text).toMatch(/Ratio 9:16, 8 seconds/);
    expect(text).toMatch(/0\.40 x distance wide and 0\.72 x distance tall/);
    expect(text).toMatch(/Photo 2 is 800x1200, plain background: cut-out available/);
    expect(text).toMatch(/Price: 420,000 RWF/);
    expect(blenderSystemPrompt()).toMatch(/No price in the brief: no price on screen/);
  });
});

describe("fitLayout", () => {
  const base = () =>
    normalizeBlenderScene(
      {
        camera: { target: [0, 0, 1.6], distance: 6 },
        product: { image: "a.jpg", height: 2.6, position: [0, 0, 0] },
        texts: [
          { text: "GALAXY A56", font: "anton", size: 0.7, position: [0, -0.3, 2.0] },
          { text: "420,000 RWF", font: "anton", size: 0.5, position: [0, -1, 0.6] },
        ],
        props: [{ kind: "sphere", size: 0.5, position: [0.2, -1, 1.2] }],
      },
      { allowPaths: true },
    ).scene;

  it("moves texts off the product, lifts the product for the price and moves props aside", () => {
    const scene = base();
    const warnings: string[] = [];
    fitLayout(scene, 1, warnings);
    const p = scene.product!;
    const [title, price] = [...scene.texts].sort((a, b) => b.position[2] - a.position[2]);
    // Price under the product, title above it.
    expect(price.position[2] + textHeight(price) / 2).toBeLessThanOrEqual(p.position[2] + 1e-9);
    expect(title.position[2] - textHeight(title) / 2).toBeGreaterThanOrEqual(p.position[2] + p.height - 1e-9);
    expect(price.position[2] - textHeight(price) / 2).toBeGreaterThanOrEqual(0.1);
    // The sphere is beside the product now, not in front of it.
    expect(Math.abs(scene.props[0].position[0])).toBeGreaterThan(1.3);
    // The camera sees it all: from the price's bottom to the title's top, with a margin.
    const tall = title.position[2] + textHeight(title) / 2 - (price.position[2] - textHeight(price) / 2);
    expect(scene.camera.distance * 0.72).toBeGreaterThan(tall);
    expect(scene.camera.distance * 0.405).toBeGreaterThan(textWidth(title));
    expect(warnings.length).toBeGreaterThan(2);
  });

  it("leaves a good layout alone", () => {
    const scene = normalizeBlenderScene(
      {
        camera: { target: [0, 0, 2.2], distance: 9.5 },
        product: { image: "a.jpg", height: 2.6, position: [0, 0, 0.9] },
        texts: [
          { text: "GALAXY A56", font: "anton", size: 0.7, position: [0, -0.3, 4.15] },
          { text: "420,000 RWF", font: "anton", size: 0.5, position: [0, -1, 0.45] },
        ],
      },
      { allowPaths: true },
    ).scene;
    const before = JSON.stringify(scene);
    const warnings: string[] = [];
    fitLayout(scene, 1, warnings);
    expect(warnings).toEqual([]);
    expect(JSON.stringify(scene)).toBe(before);
  });
});

describe("fixSpelling", () => {
  const facts = new Set(["kibagabaga", "samsung", "galaxy", "bedroom", "bedrooms", "kigali"]);
  it("puts back the brief's spelling and keeps the case", () => {
    expect(fixSpelling("KIBAGABARA", facts)).toBe("KIBAGABAGA");
    expect(fixSpelling("Samsong Galaxy", facts)).toBe("Samsung Galaxy");
    expect(fixSpelling("3 BEDROOMS in Kigali", facts)).toBe("3 BEDROOMS in Kigali");
  });
  it("leaves other words alone", () => {
    expect(fixSpelling("Discover luxury", facts)).toBe("Discover luxury");
    expect(fixSpelling("Kigoma", facts)).toBe("Kigoma");
  });
});

describe("premium staging", () => {
  const raw = (extra: Record<string, unknown> = {}) =>
    normalizeBlenderScene(
      {
        background: { kind: "studio", colors: ["#0b0d12", "#0b5fff"] },
        camera: { move: "static", intensity: 0.1 },
        look: { bloom: 0.8 },
        product: { image: "a.jpg", height: 2.6, position: [0, 0, 0.9], idle: "float" },
        texts: [
          { text: "GALAXY A56", font: "anton", size: 0.9, position: [0, -0.3, 4.0] },
          { text: "420,000 RWF", font: "anton", size: 0.6, position: [0, -0.5, 0.42] },
          { text: "+250788300400", font: "anton", size: 0.6, position: [0, -0.5, 0.1], material: "metal" },
        ],
        ...extra,
      },
      { allowPaths: true },
    ).scene;

  it("puts the product on a plinth, moves the camera and the product, and keeps the glow soft", () => {
    const scene = raw();
    const warnings: string[] = [];
    stage(scene, brief, 1, warnings);
    const plinth = scene.props.find((p) => p.kind === "plinth")!;
    expect(plinth.material).toBe("gloss");
    expect(plinth.height).toBeGreaterThanOrEqual(0.95);
    // As wide as the product + 0.6, or the phone bar + 0.4 when that is wider.
    expect(plinth.size).toBeGreaterThanOrEqual(3.2);
    expect(scene.product?.position[2]).toBe(plinth.height);
    expect(scene.product?.idle).toBe("swing");
    expect(scene.camera).toMatchObject({ move: "dollyIn", intensity: 0.35 });
    expect(scene.look.bloom).toBe(0.2);
    expect(warnings.join(" ")).toMatch(/plinth/);
  });

  it("makes the phone number a flat bar in the brand colour, in front of the plinth", () => {
    const scene = raw();
    const warnings: string[] = [];
    stage(scene, brief, 1, warnings);
    fitLayout(scene, 1, warnings);
    const bar = scene.texts.find((t) => t.text.includes("+250"))!;
    expect(bar).toMatchObject({ plate: "#0b5fff", font: "poppins", weight: "regular", depth: 0, color: "#ffffff" });
    expect(bar.size).toBeLessThanOrEqual(0.4);
    const plinth = scene.props.find((p) => p.kind === "plinth")!;
    const price = scene.texts.find((t) => t.text === "420,000 RWF")!;
    // Both on the front of the plinth: the bar at the bottom, the price above it, both under the product.
    expect(price.position[1]).toBeLessThanOrEqual(-plinth.size / 2 - 0.12 + 1e-9);
    expect(bar.position[1]).toBeLessThanOrEqual(-plinth.size / 2 - 0.12 + 1e-9);
    expect(bar.text).toBe("Call +250 788 300 400");
    expect([bar.face, price.face]).toEqual([0, 0]);
    // On a dark plinth the price is a white plate with dark letters.
    expect(price).toMatchObject({ plate: "#ffffff", color: "#111111", depth: 0 });
    expect(price.position[2] - textHeight(price) / 2).toBeGreaterThan(bar.position[2]);
    expect(price.position[2] + textHeight(price) / 2).toBeLessThanOrEqual(scene.product!.position[2] + 1e-9);
  });

  it("uses a white plinth and dark text on a light bar in daylight", () => {
    const scene = raw({ background: { kind: "daylight", colors: ["#f4f1ec", "#2f6b4f"] } });
    stage(scene, { ...brief, business: { ...brief.business, colors: ["#ffd84d"] } }, 1, []);
    expect(scene.props.find((p) => p.kind === "plinth")).toMatchObject({ material: "matte", color: "#ffffff" });
    expect(scene.texts.find((t) => t.text.includes("+250"))).toMatchObject({ plate: "#ffd84d", color: "#111111" });
    // The price: a plate in the accent wall's colour with contrasting letters.
    expect(scene.texts.find((t) => t.text === "420,000 RWF")).toMatchObject({ plate: "#2f6b4f", color: "#ffffff", depth: 0, weight: "bold" });
  });

  it("keeps a fixed lens still and the neon glow stronger", () => {
    const scene = raw({ background: { kind: "neon", colors: ["#07060f", "#7b5cff"] } });
    stage(scene, { ...brief, fixedLens: true }, 1, []);
    expect(scene.camera.move).toBe("static");
    expect(scene.look.bloom).toBe(0.4);
  });

  it("shows the product and the main title on the first frame, in a crisp bold sans that fits", () => {
    const scene = raw();
    scene.texts[0] = { ...scene.texts[0], text: "GALAXY A56 5G", font: "anton", size: 1.2, enter: "spinIn", enterAt: 0.8 };
    const warnings: string[] = [];
    stage(scene, brief, 1, warnings);
    expect(scene.product).toMatchObject({ enter: "settle", enterAt: 0, enterFor: 0.6 });
    const title = scene.texts[0];
    expect(title).toMatchObject({ font: "poppins", weight: "bold", enter: "settle", enterAt: 0 });
    // Narrower than the frame at the layout's distance (about 4.25 wide), but never below 0.6.
    expect(textWidth(title)).toBeLessThanOrEqual(10.5 * 0.405 - 0.6 + 1e-6);
    expect(title.size).toBeGreaterThanOrEqual(0.6);
    expect(warnings.join(" ")).toMatch(/first frame/);
  });

  it("recommends a look for the template and the product", () => {
    expect(lookForTemplate("3d-title-drop")).toBe("neon");
    expect(lookForTemplate("showroom-turntable", "Samsung Galaxy A56")).toBe("studio");
    expect(lookForTemplate("showroom-turntable", "3-bedroom house with garden, Kibagabaga")).toBe("daylight");
    expect(blenderBriefText(brief)).toMatch(/Recommended look for this template: "neon"/);
  });
});

describe("loop 4: photo cards, labels, the accent wall", () => {
  const house: DesignBrief = { ...brief, product: { name: "3-bedroom house with garden, Kibagabaga", price: "120,000,000 RWF" }, photos: [brief.photos[0], { ...brief.photos[0], base64: "C" }, { ...brief.photos[0], base64: "D" }] };
  const photos = [{ image: "/p/1.jpg" }, { image: "/p/2.jpg" }, { image: "/p/3.jpg" }];
  const scene = () =>
    normalizeBlenderScene(
      {
        background: { kind: "daylight", colors: ["#f4f1ec", "#2f6b4f"] },
        camera: { move: "dollyIn", intensity: 0.5, target: [0, 0, 2.4], distance: 10.5 },
        product: { photo: 1, height: 2.4, position: [0, 0, 0.95] },
        texts: [
          { text: "Kibagabaga", size: 0.9, position: [0, -0.3, 4.35] },
          { text: "Three bedrooms with a private garden", weight: "regular", size: 0.5, position: [0, -0.3, 5.2] },
          { text: "120,000,000 RWF", size: 0.55, position: [0, -1.5, 0.6] },
        ],
      },
      { photos },
    ).scene;

  it("shows every photo on a wide card that fills 40 % of the frame", () => {
    const s1 = scene();
    const warnings: string[] = [];
    const aspect = stage(s1, house, 1, warnings, photos);
    fitLayout(s1, aspect, warnings);
    fillFrame(s1, aspect, warnings);
    const p = s1.product!;
    expect(p.more).toEqual([2, 3]);
    expect(p.gallery).toEqual(["/p/2.jpg", "/p/3.jpg"]);
    expect(p.crop).toBe(1.15);
    expect(aspect).toBe(1.15);
    expect(s1.camera.move).toBe("orbitRight");
    const widest = 1;
    expect(p.height / (0.72 * s1.camera.distance * widest)).toBeGreaterThanOrEqual(0.399);
    // The title stays clear above the bigger card.
    const title = s1.texts.find((t) => t.text === "Kibagabaga")!;
    expect(title.position[2] - textHeight(title) / 2).toBeGreaterThanOrEqual(p.position[2] + p.height - 1e-9);
  });

  it("keeps a cut-out single", () => {
    const s1 = scene();
    s1.product!.cutout = "/p/1-cut.png";
    stage(s1, house, 0.55, [], photos);
    expect(s1.product!.more).toEqual([]);
    expect(s1.product!.crop).toBeNull();
  });

  it("keeps lines inside the daylight accent wall: smaller, then on two lines", () => {
    const s1 = scene();
    stage(s1, house, 1, [], photos);
    const line = s1.texts.find((t) => t.text.startsWith("Three"))!;
    expect(line.text).toContain("\n");
    expect(line.size).toBeGreaterThanOrEqual(0.4);
    // Narrower than the wall seen from the text's depth (about 5.5) minus the dolly-free margin.
    expect(textWidth(line)).toBeLessThanOrEqual(5.6);
    expect(wrapInTwo("Byakorewe mu Rwanda")).toBe("Byakorewe\nmu Rwanda");
  });

  it("labels the phone number with what it is for", () => {
    expect(phoneLabel(brief)).toBe("Call");
    expect(phoneLabel({ ...brief, product: { ...brief.product, usps: ["Order on WhatsApp"] } })).toBe("WhatsApp");
    expect(phoneLabel({ ...brief, business: { ...brief.business, language: "rw" } })).toBe("Hamagara");
  });
});

describe("loop 5: looks per template, cut-outs fill the frame", () => {
  it("has a look for every engine template, with a name the site can show", () => {
    for (const t of VIDEO_TEMPLATES) {
      expect(TEMPLATE_LOOKS[t.id], t.id).toBeDefined();
      expect(BLENDER_LOOK_NAMES[lookForTemplate(t.id)]).toMatch(/showroom|Daylight|Neon/);
    }
    expect(lookForTemplate("confetti-launch", "Kitenge summer dress")).toBe("neon");
    expect(lookForTemplate("chrome-luxe", "Kitenge summer dress")).toBe("daylight");
    expect(lookForTemplate("golden-hour")).toBe("daylight");
    expect(lookForTemplate("dark-minimal")).toBe("studio");
    expect(lookForTemplate("unknown-template")).toBe("studio");
  });

  it("grows a cut-out to 40 % of the frame too, using the cut-out's own shape", () => {
    const photos = [{ image: "/p/1.jpg", cutout: "/p/1.png", cutoutAspect: 0.55 }];
    const s1 = normalizeBlenderScene(
      { background: { kind: "daylight", colors: ["#f4f1ec", "#e84a7f"] }, camera: { move: "orbitRight", intensity: 0.35, distance: 13 }, product: { photo: 1, height: 2.8, position: [0, 0, 0.95] }, texts: [{ text: "Kitenge", size: 0.9, position: [0, -0.3, 4.3] }] },
      { photos },
    ).scene;
    const warnings: string[] = [];
    const aspect = stage(s1, { ...brief, photos: [brief.photos[0]] }, 0.55, warnings, photos);
    fitLayout(s1, aspect, warnings);
    fillFrame(s1, aspect, warnings);
    expect(s1.product!.more).toEqual([]);
    expect(s1.product!.height / (0.72 * s1.camera.distance)).toBeGreaterThanOrEqual(0.399);
    expect(warnings.join(" ")).toMatch(/cut-out is bigger/);
  });
});
