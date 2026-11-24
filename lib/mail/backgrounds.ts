// B Mail backgrounds (design "Main" quick settings, owner 23 Nov 2026: Kigali scenes, gradients, Random, own photo).
// Pure: the shell, Quick settings, Settings and the server action share it. Random picks a scene per person per day
// (the same all day, so the page does not flash between server and browser).

export type MailBackground = { id: string; name: string; css: string; dark?: boolean };

const scene = (file: string) => `url(/mail/backgrounds/${file}.svg) center bottom / cover no-repeat`;

export const MAIL_BACKGROUNDS: MailBackground[] = [
  { id: "kigali-hills", name: "Kigali hills", css: scene("kigali-hills") },
  { id: "kigali-night", name: "Kigali at night", css: scene("kigali-night"), dark: true },
  { id: "kivu-beach", name: "Lake Kivu beach", css: scene("kivu-beach") },
  { id: "virunga", name: "Virunga volcanoes", css: scene("virunga") },
  { id: "kivu-dusk", name: "Kivu dusk", css: "radial-gradient(1100px 700px at 8% -10%, #ffd2b8 0%, rgba(255,210,184,0) 60%), radial-gradient(900px 700px at 95% 0%, #bfd2ff 0%, rgba(191,210,255,0) 58%), radial-gradient(1100px 800px at 55% 110%, #d6c6ff 0%, rgba(214,198,255,0) 62%), #eef1f8" },
  { id: "nyungwe", name: "Nyungwe", css: "radial-gradient(1000px 700px at 15% 0%, #b8e6c0 0%, rgba(184,230,192,0) 60%), radial-gradient(1000px 800px at 90% 100%, #7cc59a 0%, rgba(124,197,154,0) 60%), #e3f1e7" },
  { id: "sunrise", name: "Sunrise", css: "linear-gradient(150deg, #ffd8bd 0%, #ffbfcb 50%, #dcc8ff 100%)" },
  { id: "ocean", name: "Ocean", css: "linear-gradient(150deg, #c6ebff 0%, #9fcbff 50%, #b6b8ff 100%)" },
  { id: "imigongo", name: "Imigongo", css: "repeating-linear-gradient(45deg, rgba(90,50,30,.10) 0 16px, rgba(255,255,255,0) 16px 32px), repeating-linear-gradient(-45deg, rgba(90,50,30,.10) 0 16px, rgba(255,255,255,0) 16px 32px), #efe3d4" },
  { id: "sand", name: "Sand", css: "linear-gradient(150deg, #f6eadb 0%, #e9d5bb 100%)" },
  { id: "volcano-night", name: "Volcano night", css: "radial-gradient(1000px 700px at 15% 0%, #4a2f73 0%, rgba(74,47,115,0) 60%), radial-gradient(1000px 800px at 95% 100%, #1d4185 0%, rgba(29,65,133,0) 60%), #12131a", dark: true },
  { id: "aurora", name: "Aurora", css: "radial-gradient(900px 600px at 20% 10%, #1fb58f 0%, rgba(31,181,143,0) 60%), radial-gradient(900px 700px at 85% 30%, #5b5bff 0%, rgba(91,91,255,0) 60%), #0e1424", dark: true },
  { id: "plain", name: "Plain", css: "var(--bmail-plain)" },
];

export const RANDOM_BACKGROUND = "random";
export const PHOTO_BACKGROUND = "photo";
const IDS = new Set([...MAIL_BACKGROUNDS.map((b) => b.id), RANDOM_BACKGROUND, PHOTO_BACKGROUND]);

export const isMailBackground = (id: unknown): id is string => typeof id === "string" && IDS.has(id);

/** The background to paint today: Random becomes one of the four scenes (per person, per Kigali day). */
export function resolveBackground(choice: unknown, seed: string, now = new Date()): MailBackground {
  const id = isMailBackground(choice) ? choice : "kigali-hills";
  if (id === RANDOM_BACKGROUND) {
    const day = now.toLocaleDateString("en-CA", { timeZone: "Africa/Kigali" });
    let h = 0;
    for (const ch of `${seed}:${day}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return MAIL_BACKGROUNDS[h % 4];
  }
  return MAIL_BACKGROUNDS.find((b) => b.id === id) ?? MAIL_BACKGROUNDS[0];
}

/** Glass: 0 = clear .. 100 = frosted, as the design's slider (panel opacity and blur grow with it). */
export function glassStyle(clarity: number, dark: boolean): { alpha: number; strong: number; blur: number } {
  const c = Math.max(0, Math.min(100, Math.round(clarity)));
  const cap = dark ? 0.9 : 0.96;
  return { alpha: Math.min(cap, 0.42 + c * 0.005), strong: Math.min(cap, 0.6 + c * 0.005), blur: Math.round(6 + c * 0.3) };
}
