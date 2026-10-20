"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Share, SquarePlus, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui";
import { INSTALL_DISMISSED_KEY, installPlatform, isStandalone } from "@/lib/phone-app";

// BuPulse as a phone app (docs/guide/features/32-phone-app-and-whatsapp-share.md): the service worker for every
// signed-in person, and the "Install BuPulse on your phone" prompt in the dashboard.

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

declare global {
  interface Window {
    /** Chrome's install offer, kept by the inline script below when it came before React was ready. */
    __bpInstall?: InstallEvent;
  }
}

/** The push service worker (public/sw.js): no caching, it only shows lead alerts. Registering it is harmless when alerts are off. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

// Chrome offers the install once, early, often before the page's scripts run: this inline script keeps the offer (and
// stops Chrome's own bar, as the dashboard shows its prompt instead). Same pattern as components/theme/theme-script.tsx.
const CAPTURE = `(function(){try{window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__bpInstall=e})}catch(_){}})()`;

/** In every dashboard page: registers the service worker and keeps Chrome's install offer for the prompt. */
export function PhoneAppSetup() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    registerServiceWorker().catch(() => {
      // Private windows and some browsers refuse service workers: BuPulse works the same without one.
    });
  }, []);
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: CAPTURE }}
    />
  );
}

type View = "hidden" | "android" | "ios";

const listeners = new Set<() => void>();
let installed = false;
let dismissedNow = false;

function notify() {
  listeners.forEach((l) => l());
}

function readDismissed(): boolean {
  if (dismissedNow) return true;
  try {
    return window.localStorage.getItem(INSTALL_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function view(): View {
  if (installed || readDismissed()) return "hidden";
  const standalone = isStandalone(window.matchMedia("(display-mode: standalone)").matches, (navigator as { standalone?: unknown }).standalone);
  if (standalone) return "hidden";
  const platform = installPlatform(navigator.userAgent, navigator.maxTouchPoints);
  if (platform === "ios") return "ios";
  // Android: only while Chrome offers the install (it does not once BuPulse is installed).
  return platform === "android" && window.__bpInstall ? "android" : "hidden";
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onOffer = (e: Event) => {
    e.preventDefault();
    window.__bpInstall = e as InstallEvent;
    notify();
  };
  const onInstalled = () => {
    installed = true;
    window.__bpInstall = undefined;
    notify();
  };
  window.addEventListener("beforeinstallprompt", onOffer);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("beforeinstallprompt", onOffer);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

/**
 * "Install BuPulse on your phone": on Android an Install button (Chrome's own install), on an iPhone the two taps in
 * the Share menu. Never shown in the installed app, on computers, or after "Not now" (remembered on this device).
 */
export function InstallPrompt() {
  const shown = useSyncExternalStore(subscribe, view, () => "hidden" as const);
  if (shown === "hidden") return null;

  const dismiss = () => {
    dismissedNow = true;
    try {
      window.localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
    } catch {
      // Then it stays hidden until the page is opened again.
    }
    notify();
  };

  const install = async () => {
    const offer = window.__bpInstall;
    if (!offer) return;
    // Chrome's offer works once: whatever the answer, the prompt goes (Chrome's menu still has "Install app").
    window.__bpInstall = undefined;
    try {
      await offer.prompt();
      if ((await offer.userChoice).outcome === "accepted") installed = true;
    } catch {
      // Chrome refused to show it again: its menu still has "Install app".
    }
    notify();
  };

  return (
    <section aria-labelledby="install-app" className="glass-strong flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[20px] border border-pulse-blue/30 p-3.5 pr-3 sm:px-4">
      <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white">
        <Smartphone className="size-5" />
      </span>
      <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1">
        <h2 id="install-app" className="text-[15px] font-semibold leading-snug">
          Install BuPulse on your phone
        </h2>
        {shown === "android" ? (
          <p className="text-[14px] text-muted">Open it from your Home Screen like any app: full screen, one tap away.</p>
        ) : (
          <ol className="flex flex-col gap-1 text-[14px] text-muted">
            <li>
              1. Tap <strong className="font-semibold text-text">Share</strong> <Share aria-hidden className="inline size-4 align-text-bottom text-pulse-blue" /> in the browser bar.
            </li>
            <li>
              2. Choose <strong className="font-semibold text-text">Add to Home Screen</strong> <SquarePlus aria-hidden className="inline size-4 align-text-bottom text-pulse-blue" />. Scroll down the list if you do not see it.
            </li>
          </ol>
        )}
      </div>
      <div className="ml-auto flex items-center gap-1">
        {shown === "android" && (
          <Button size="sm" onClick={install}>
            Install
          </Button>
        )}
        <button type="button" onClick={dismiss} aria-label="Not now, hide the install tip" className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft">
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </section>
  );
}
