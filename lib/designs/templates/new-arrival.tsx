import { renderPack } from "./packs";
import type { LayoutProps } from "./shared";

export const newArrival = (props: LayoutProps) => renderPack(props, { mode: "photo", badge: "pill" });
