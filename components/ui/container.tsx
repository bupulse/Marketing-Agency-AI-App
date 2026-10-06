import type { ElementType, HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type ContainerProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  size?: "narrow" | "default" | "wide";
};

const sizes = { narrow: "max-w-3xl", default: "max-w-6xl", wide: "max-w-7xl" } as const;

/** Centered page width with responsive gutters (16px on phones). */
export function Container({ as, size = "default", className, ...props }: ContainerProps) {
  const Tag = (as ?? "div") as ElementType;
  return <Tag className={cn("mx-auto w-full px-4 sm:px-6 lg:px-8", sizes[size], className)} {...props} />;
}
