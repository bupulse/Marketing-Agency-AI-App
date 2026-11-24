// B Mail backgrounds (design "Main" quick settings, owner 23 Nov 2026: Rwanda photos (public, 24 Nov: not drawn), gradients, Random, own photo).
// Pure: the shell, Quick settings, Settings and the server action share it. Random picks a scene per person per day
// (the same all day, so the page does not flash between server and browser).

export type PhotoCredit = { author: string; license: string; licenseUrl: string; source: string };
export type MailBackground = { id: string; name: string; css: string; dark?: boolean; thumb?: string; credit?: PhotoCredit };

// Public photos from Wikimedia Commons (free licences; credit shown on screen). Resized to 2400 px in public/mail/backgrounds.
const commons = (file: string) => `https://commons.wikimedia.org/wiki/File:${file}`;
const BY_SA_4 = { license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" };
const BY_SA_3 = { license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/" };
const BY_2 = { license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0/" };
const CC0 = { license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" };
const photo = (id: string, name: string, credit: PhotoCredit, dark?: boolean): MailBackground => ({
  id, name, dark, credit,
  // The small thumb (already loaded by the picker) shows under the full photo until it arrives: no blank wait.
  css: `url(/mail/backgrounds/${id}.jpg) center / cover no-repeat, url(/mail/backgrounds/${id}-thumb.jpg) center / cover no-repeat, #6b7f99`,
  thumb: `url(/mail/backgrounds/${id}-thumb.jpg) center / cover no-repeat, #6b7f99`,
});

export const MAIL_BACKGROUNDS: MailBackground[] = [
  photo("kigali-hills", "Hills of Rwanda", { author: "Ericnkurunziza", ...BY_SA_4, source: commons("Hills_of_Nyamagabe_in_Rwanda.jpg") }),
  photo("kigali-night", "Kigali at night", { author: "Cyr", ...BY_SA_3, source: commons("The_view_across_Kigali_in_Rwanda_at_night.jpg") }, true),
  photo("kivu-beach", "Lake Kivu", { author: "Ludovic Hirlimann", ...BY_SA_4, source: commons("Boating_on_lake_Kivu.jpg") }, true),
  photo("virunga", "Virunga volcanoes", { author: "flöschen", ...BY_2, source: commons("Virunga_Volcanoes_(5444965000).jpg") }),
  photo("kigali-dusk", "Kigali at dusk", { author: "Adrien K", ...BY_2, source: commons("Kigali2018.jpg") }, true),
  photo("nyungwe-sunrise", "Nyungwe sunrise", { author: "Jonkmania", ...BY_SA_4, source: commons("Sunrisenyungwe.jpg") }, true),
  photo("nyungwe-clouds", "Nyungwe clouds", { author: "Dpiskho", ...BY_SA_4, source: commons("NYUNGWE_CLOUDS.jpg") }),
  photo("kivu-sunset", "Kivu sunset", { author: "NicyK20", ...CC0, source: commons("Sunset_on_lake_Kivu.jpg") }),
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

const PHOTO_COUNT = MAIL_BACKGROUNDS.filter((b) => b.credit).length;

/** The small picture for a picker swatch (the full photo is ~500 KB, the thumb ~10 KB). */
export const swatchCss = (b: MailBackground) => b.thumb ?? b.css;

export const RANDOM_BACKGROUND = "random";
export const PHOTO_BACKGROUND = "photo";
const IDS = new Set([...MAIL_BACKGROUNDS.map((b) => b.id), RANDOM_BACKGROUND, PHOTO_BACKGROUND]);

export const isMailBackground = (id: unknown): id is string => typeof id === "string" && IDS.has(id);

/** The background to paint today: Random becomes one of the photos (per person, per Kigali day). */
export function resolveBackground(choice: unknown, seed: string, now = new Date()): MailBackground {
  const id = isMailBackground(choice) ? choice : "kigali-hills";
  if (id === RANDOM_BACKGROUND) {
    const day = now.toLocaleDateString("en-CA", { timeZone: "Africa/Kigali" });
    let h = 0;
    for (const ch of `${seed}:${day}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return MAIL_BACKGROUNDS[h % PHOTO_COUNT];
  }
  return MAIL_BACKGROUNDS.find((b) => b.id === id) ?? MAIL_BACKGROUNDS[0];
}

/** Glass: 0 = clear .. 100 = frosted, as the design's slider (panel opacity and blur grow with it). */
export function glassStyle(clarity: number, dark: boolean): { alpha: number; strong: number; blur: number } {
  const c = Math.max(0, Math.min(100, Math.round(clarity)));
  const cap = dark ? 0.9 : 0.96;
  return { alpha: Math.min(cap, 0.42 + c * 0.005), strong: Math.min(cap, 0.6 + c * 0.005), blur: Math.round(6 + c * 0.3) };
}
