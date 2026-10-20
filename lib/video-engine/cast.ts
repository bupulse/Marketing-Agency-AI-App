// Cartoon presenters of the Claude video engine (docs/VIDEO_ENGINE.md, "AI influencers"): drawn by the engine itself
// (CharacterLayer in spec.ts, drawCharacter in draw.ts), so they are free and unlimited. They blink, breathe, gesture
// and move their mouths while they "talk". Illustrated, never realistic. Data only.
import type { CharacterLayer } from "./spec";

export type CartoonPresenter = { id: string; name: string; about: string } & Pick<CharacterLayer, "skin" | "hair" | "hairColor" | "outfit" | "accent" | "glasses">;

export const CARTOON_CAST: CartoonPresenter[] = [
  { id: "keza", name: "Keza", about: "friendly young woman, braids, bright yellow top", skin: "#8d5524", hair: "braids", hairColor: "#1b1b1b", outfit: "#f5b700", accent: "#2f6bff" },
  { id: "bosco", name: "Bosco", about: "cheerful man, short hair, blue shirt, glasses", skin: "#6b3e1f", hair: "short", hairColor: "#141414", outfit: "#2f6bff", accent: "#ffffff", glasses: true },
  { id: "mama-uwase", name: "Mama Uwase", about: "warm older woman, hair in a bun, green dress", skin: "#7a4a2a", hair: "bun", hairColor: "#2a2a2a", outfit: "#1f8a5b", accent: "#f5d06f" },
  { id: "ganza", name: "Ganza", about: "young man, twists, purple hoodie", skin: "#5c3317", hair: "twists", hairColor: "#111111", outfit: "#7b5cff", accent: "#ffffff" },
  { id: "ineza", name: "Ineza", about: "confident woman, afro, red blazer", skin: "#a0673f", hair: "afro", hairColor: "#1e1410", outfit: "#d7263d", accent: "#111111" },
  { id: "teta", name: "Teta", about: "student, long hair, pink top", skin: "#9c6644", hair: "long", hairColor: "#1b1b1b", outfit: "#ff6fb5", accent: "#ffffff" },
];

export const castById = (id: string | null | undefined) => CARTOON_CAST.find((c) => c.id === id) ?? null;
