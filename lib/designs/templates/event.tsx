import { renderPack } from "./packs";
import type { LayoutProps } from "./shared";

export const event = (props: LayoutProps) => renderPack(props, { mode: "card", badge: "block" });
