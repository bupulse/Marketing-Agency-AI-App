import { renderPack } from "./packs";
import type { LayoutProps } from "./shared";

export const quote = (props: LayoutProps) => renderPack(props, { mode: "quote" });
