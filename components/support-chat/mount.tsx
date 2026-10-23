"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type ComponentType } from "react";
import { usePathname } from "next/navigation";
import { chatSurface } from "@/lib/support/client/mount";
import type { Surface } from "@/lib/support/contract";
import { Launcher } from "./launcher";
import type { WidgetProps } from "./widget";

const noop = () => () => {};

/**
 * BuPulse's help chat on every page the root layout draws, except where chatSurface says no (Admin, the support app,
 * bio pages…). Only the button is drawn at first; the chat itself (./widget) loads when the browser is idle or on the
 * first tap, so it never slows the page down.
 */
export function SupportChatMount() {
  const pathname = usePathname();
  // null on the server and while hydrating: the host is only known in the browser.
  const host = useSyncExternalStore(noop, () => window.location.hostname, () => null);
  const surface: Surface | null = host === null ? null : chatSurface(pathname, host);
  const [Widget, setWidget] = useState<ComponentType<WidgetProps> | null>(null);
  const [openOnLoad, setOpenOnLoad] = useState(false);

  const load = useCallback(() => {
    void import("./widget").then((m) => setWidget(() => m.Widget)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!surface || Widget) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(load, { timeout: 5000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(load, 2500);
    return () => clearTimeout(t);
  }, [surface, Widget, load]);

  if (!surface) return null;
  if (!Widget)
    return (
      <Launcher
        onIntent={load}
        onClick={() => {
          setOpenOnLoad(true);
          load();
        }}
      />
    );
  return <Widget key={surface} surface={surface} pathname={pathname} mode="floating" initialOpen={openOnLoad} />;
}
