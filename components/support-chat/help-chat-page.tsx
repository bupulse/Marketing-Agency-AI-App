"use client";

import { useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Surface } from "@/lib/support/contract";
import { Widget } from "./widget";

const noop = () => () => {};

/** /help-chat: the chat itself, always open. Closing goes back to where the visitor came from (their bio page). */
export function HelpChatPage({ surface }: { surface: Surface }) {
  const pathname = usePathname();
  const router = useRouter();
  // Drawn in the browser only: the chat reads storage and the screen size.
  const ready = useSyncExternalStore(noop, () => true, () => false);
  if (!ready) return null;
  return (
    <Widget
      surface={surface}
      pathname={pathname}
      mode="page"
      onLeave={() => {
        if (window.history.length > 1 && document.referrer) window.history.back();
        else router.push("/");
      }}
    />
  );
}
