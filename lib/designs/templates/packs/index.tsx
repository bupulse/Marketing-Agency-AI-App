import type { ReactElement } from "react";
import type { LayoutProps, Spec } from "../shared";
import { bold } from "./bold";
import { clean } from "./clean";
import { elegant } from "./elegant";
import { playful } from "./playful";
import { warm } from "./warm";

type LegacyPack = "clean" | "elegant" | "bold" | "warm" | "playful";
const PACK_LAYOUTS: Record<LegacyPack, (props: LayoutProps, spec: Spec) => ReactElement> = { clean, elegant, bold, warm, playful };

// The newer styles are drawn by the design library (lib/designs/library); the seven classic templates draw them
// with the closest classic pack, in that pack's own font.
const CLASSIC: Record<LayoutProps["pack"], LegacyPack> = {
  clean: "clean",
  elegant: "elegant",
  bold: "bold",
  warm: "warm",
  playful: "playful",
  minimal: "clean",
  luxe: "elegant",
  vibrant: "playful",
  earthy: "warm",
  corporate: "clean",
  fresh: "warm",
  retro: "bold",
};

/** The classic pack that draws the seven templates for a style (its fonts are the ones to load). */
export function classicPack(pack: LayoutProps["pack"]): LegacyPack {
  return CLASSIC[pack] ?? "clean";
}

/** Draws a template (its `Spec`) in the style pack of `props.pack`. */
export function renderPack(props: LayoutProps, spec: Spec): ReactElement {
  const pack = classicPack(props.pack);
  return PACK_LAYOUTS[pack]({ ...props, pack }, spec);
}
