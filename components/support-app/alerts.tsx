"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { BellRing, Download, Share, SquarePlus } from "lucide-react";
import { base64UrlDecode } from "@/lib/push/web-push";
import { installPlatform, isStandalone } from "@/lib/phone-app";
import { useSupportApp } from "./app-context";
import { useSupportBase, useSupportHref } from "./base";

// Alerts and installing (docs/SUPPORT_CHAT.md "Support app and Admin"): a chime and a browser notification for a new
// chat or a hand-over, push to the phone when the app is closed, and the support app as an installable app. The
// browser is asked for notifications only after a click on "Get alerts on this device".

/** The support service worker, limited to the support app ("/" on its own host, "/support/" elsewhere). */
export function registerSupportWorker(base: string): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/support-sw.js", { scope: base ? `${base}/` : "/", updateViaCache: "none" });
}

let audio: AudioContext | null = null;

/** Two soft notes, made in the browser (no sound file to load). Silent until the page has had a click. */
export function playChime() {
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.18, t + i * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.35);
      osc.connect(gain).connect(audio.destination);
      osc.start(t + i * 0.16);
      osc.stop(t + i * 0.16 + 0.4);
    }
  } catch {
    // No sound on this browser: the notification and the list still show it.
  }
}

/** A chime, plus a browser notification when allowed. Tapping it opens the chat. */
export function alertAgent(title: string, body: string, url: string) {
  playChime();
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, icon: "/icons/icon-192.png", tag: url });
    n.onclick = () => {
      window.focus();
      window.location.assign(url);
      n.close();
    };
  } catch {
    // Android Chrome only shows notifications through the service worker.
    void navigator.serviceWorker?.ready.then((r) => r.showNotification(title, { body, icon: "/icons/icon-192.png", tag: url, data: { url } })).catch(() => undefined);
  }
}

const noop = () => () => {};

type Permission = "unsupported" | "default" | "granted" | "denied" | "ios-install";

function devicePlatform() {
  if (typeof navigator === "undefined") return { ios: false, standalone: false };
  const standalone = isStandalone(window.matchMedia("(display-mode: standalone)").matches, (navigator as { standalone?: unknown }).standalone);
  return { ios: installPlatform(navigator.userAgent, navigator.maxTouchPoints) === "ios", standalone };
}

function readPermission(): Permission {
  const { ios, standalone } = devicePlatform();
  // An iPhone shows web notifications only for an app added to the Home Screen.
  if (ios && !standalone) return "ios-install";
  if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) return "unsupported";
  return Notification.permission;
}

/** "Get alerts on this device": asks the browser once, then registers push for this agent (when push is set up). */
export function AlertsButton({ className }: { className?: string }) {
  const { api, pushKey, fail, preview } = useSupportApp();
  const base = useSupportBase();
  // What the browser says now; after the click, its answer.
  const current = useSyncExternalStore(noop, readPermission, () => "default" as const);
  const [answer, setPermission] = useState<Permission | null>(null);
  const permission = answer ?? current;
  const [note, setNote] = useState<string | null>(null);

  async function enable() {
    setNote(null);
    const answer = await Notification.requestPermission();
    setPermission(answer);
    if (answer !== "granted") return setNote("Alerts are blocked. Allow notifications for this site in the browser settings.");
    playChime();
    if (!pushKey || preview) return setNote("Alerts are on while the app is open.");
    try {
      const reg = await registerSupportWorker(base);
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlDecode(pushKey) });
      const json = sub.toJSON();
      if (json.endpoint && json.keys?.p256dh && json.keys.auth) await api.addDevice({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth }, label: navigator.userAgent.slice(0, 120) });
      setNote("Alerts are on, also when the app is closed.");
    } catch (e) {
      setNote(`Alerts work while the app is open. ${fail(e)}`);
    }
  }

  if (permission === "unsupported") return null;
  return (
    <div className={className}>
      {permission === "ios-install" ? (
        <p className="text-[12.5px] leading-snug">
          <strong>iPhone alerts:</strong> Add to Home Screen first (<Share aria-hidden className="inline size-3.5" /> then <SquarePlus aria-hidden className="inline size-3.5" />), then open BuPulse Support from there.
        </p>
      ) : permission === "granted" && !note ? (
        <p className="flex items-center gap-1.5 text-[12.5px]"><BellRing aria-hidden className="size-3.5" /> Alerts on</p>
      ) : (
        <button type="button" onClick={enable} disabled={permission === "denied"} className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-3 text-left text-[13px] font-semibold hover:bg-white/15 disabled:cursor-default disabled:opacity-70">
          <BellRing aria-hidden className="size-4 shrink-0" /> {permission === "denied" ? "Alerts blocked in the browser" : "Get alerts on this device"}
        </button>
      )}
      {note && <p role="status" className="px-3 pt-1 text-[12px] opacity-90">{note}</p>}
    </div>
  );
}

type InstallEvent = Event & { prompt: () => Promise<void> };
let offer: InstallEvent | null = null;
const listeners = new Set<() => void>();
function subscribeInstall(cb: () => void) {
  listeners.add(cb);
  const on = (e: Event) => {
    e.preventDefault();
    offer = e as InstallEvent;
    listeners.forEach((l) => l());
  };
  const done = () => {
    offer = null;
    listeners.forEach((l) => l());
  };
  window.addEventListener("beforeinstallprompt", on);
  window.addEventListener("appinstalled", done);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("beforeinstallprompt", on);
    window.removeEventListener("appinstalled", done);
  };
}

/** Registers the support service worker, and offers "Install the app" where the browser allows it (Chrome, Edge). */
export function InstallApp({ className }: { className?: string }) {
  const base = useSupportBase();
  const href = useSupportHref();
  const can = useSyncExternalStore(subscribeInstall, () => !!offer, () => false);
  useEffect(() => {
    if ("serviceWorker" in navigator) registerSupportWorker(base).catch(() => undefined);
  }, [base]);
  if (!can) return null;
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        const o = offer;
        offer = null;
        listeners.forEach((l) => l());
        await o?.prompt().catch(() => undefined);
      }}
      title={`Installs ${href("/")} as an app on this device`}
    >
      <Download aria-hidden className="size-4 shrink-0" /> Install the app
    </button>
  );
}
