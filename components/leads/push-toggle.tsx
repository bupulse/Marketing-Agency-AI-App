"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRing } from "lucide-react";
import { removePushDevice, savePushDevice } from "@/app/dashboard/leads/actions";
import { Switch } from "@/components/autopilot/switch";
import { GlassCard, useToast } from "@/components/ui";

type State = "checking" | "unsupported" | "denied" | "off" | "on";

function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64Url.length / 4) * 4, "=");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** A subscription made with another server key (the keys were changed) cannot receive our alerts. */
function sameKey(subscription: PushSubscription, publicKey: string): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = keyBytes(publicKey);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** "Chrome on Android": a label the person recognises in a list of their devices. */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iPhone" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}

/**
 * "Alerts on this device": a push notification on this phone or computer for every new lead (Web Push, free). Each
 * person switches it on per device; `registered` are the devices BuPulse already sends to for this person.
 */
export function PushToggle({ publicKey, registered }: { publicKey: string; registered: string[] }) {
  const { toast } = useToast();
  const [state, setState] = useState<State>("checking");
  const [pending, start] = useTransition();
  const known = registered.join("\n");

  useEffect(() => {
    let live = true;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported" as const;
      if (Notification.permission === "denied") return "denied" as const;
      const sub = await (await registration()).pushManager.getSubscription();
      return sub && known.split("\n").includes(sub.endpoint) && sameKey(sub, publicKey) ? ("on" as const) : ("off" as const);
    })().then(
      (next) => live && setState(next),
      () => live && setState("unsupported"),
    );
    return () => {
      live = false;
    };
  }, [known, publicKey]);

  function turnOn() {
    start(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setState(permission === "denied" ? "denied" : "off");
          return;
        }
        const reg = await registration();
        let sub = await reg.pushManager.getSubscription();
        if (sub && !sameKey(sub, publicKey)) {
          await sub.unsubscribe();
          sub = null;
        }
        sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
        const json = sub.toJSON();
        const result = await savePushDevice({ endpoint: json.endpoint, keys: json.keys, device: deviceLabel() });
        if (!result.ok) {
          toast(result.error, "error");
          return;
        }
        setState("on");
        toast("Alerts are on for this device.", "success");
      } catch {
        toast("This browser could not switch alerts on. Please try again.", "error");
      }
    });
  }

  function turnOff() {
    start(async () => {
      try {
        const sub = await (await registration()).pushManager.getSubscription();
        if (sub) {
          const result = await removePushDevice(sub.endpoint);
          if (!result.ok) {
            toast(result.error, "error");
            return;
          }
          await sub.unsubscribe();
        }
        setState("off");
        toast("Alerts are off for this device.", "success");
      } catch {
        toast("This browser could not switch alerts off. Please try again.", "error");
      }
    });
  }

  const note =
    state === "unsupported"
      ? "This browser cannot show alerts. On an iPhone, add BuPulse to your Home Screen first (Share, then Add to Home Screen) and open it from there."
      : state === "denied"
        ? "Notifications are blocked for BuPulse in this browser. Allow them in the browser's site settings, then come back here."
        : null;

  return (
    <GlassCard as="section" aria-labelledby="device-alerts" className="flex flex-col gap-2 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="device-alerts" className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em]">
            <BellRing aria-hidden className="size-5 text-pulse-blue" />
            Alerts on this device
          </h2>
          <p className="text-[14px] text-muted">A notification on this phone or computer for every new lead, even when BuPulse is closed. Free. Turn it on on each device you use.</p>
        </div>
        <Switch checked={state === "on"} onChange={(v) => (v ? turnOn() : turnOff())} label="Alerts on this device" disabled={pending || state === "checking" || state === "unsupported" || state === "denied"} />
      </div>
      {note && (
        <p role="note" className="rounded-2xl bg-soft px-4 py-3 text-[14px] text-muted">
          {note}
        </p>
      )}
    </GlassCard>
  );
}
