import { renderPack } from "./packs";
import type { LayoutProps } from "./shared";

export const justListed = (props: LayoutProps) => renderPack(props, { mode: "photo", badge: "pill", frame: true });
