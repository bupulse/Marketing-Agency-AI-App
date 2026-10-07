import { renderPack } from "./packs";
import type { LayoutProps } from "./shared";

export const offer = (props: LayoutProps) => renderPack(props, { mode: "card", badge: "circle" });
