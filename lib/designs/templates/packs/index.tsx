import type { ReactElement } from "react";
import type { LayoutProps, Spec } from "../shared";
import { bold } from "./bold";
import { clean } from "./clean";
import { elegant } from "./elegant";
import { playful } from "./playful";
import { warm } from "./warm";

const PACK_LAYOUTS: Record<LayoutProps["pack"], (props: LayoutProps, spec: Spec) => ReactElement> = { clean, elegant, bold, warm, playful };

/** Draws a template (its `Spec`) in the style pack of `props.pack`. */
export function renderPack(props: LayoutProps, spec: Spec): ReactElement {
  return PACK_LAYOUTS[props.pack](props, spec);
}
