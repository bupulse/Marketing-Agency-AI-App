import { renderPack } from "./packs";
import type { LayoutProps } from "./shared";

export const announcement = (props: LayoutProps) => renderPack(props, { mode: "photo", badge: "pill", tint: true });
