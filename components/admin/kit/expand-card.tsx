import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { IconBadge } from "./icon-badge";
import { ExpandShell } from "./expand-shell";
import type { KitTone } from "./tones";

/**
 * A card that shows a short summary and opens its details on hover (with a mouse), on tap, and on keyboard focus.
 * The header is a real button (aria-expanded): a tap or Enter pins it open or closed. Moving the mouse over it peeks
 * the details; a card closed on purpose stays closed until the mouse leaves. Anything focusable inside opens it while
 * it has focus, so nothing is ever reachable but hidden. No animation under reduced motion. Usable from server
 * components (the icon is drawn here; only the open/close part runs in the browser).
 */
export function ExpandCard({
  icon,
  tone = "blue",
  title,
  summary,
  aside,
  children,
  defaultOpen = false,
  className,
}: {
  icon?: LucideIcon;
  tone?: KitTone;
  title: ReactNode;
  /** The one line always shown (the key number, a status). */
  summary?: ReactNode;
  /** Right side of the header (a number, a pill). */
  aside?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <ExpandShell badge={icon ? <IconBadge icon={icon} tone={tone} /> : undefined} title={title} label={typeof title === "string" ? title : undefined} summary={summary} aside={aside} defaultOpen={defaultOpen} className={className}>
      {children}
    </ExpandShell>
  );
}
