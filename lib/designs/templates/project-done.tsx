import { renderPack } from "./packs";
import type { LayoutProps } from "./shared";

export const projectDone = (props: LayoutProps) => renderPack(props, { mode: "card", badge: "pill" });
