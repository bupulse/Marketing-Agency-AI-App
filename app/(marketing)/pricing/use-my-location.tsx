"use client";

import { MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Asks the browser for the visitor's position (with their permission), sends it once to /api/geo/country, then refreshes the prices. */
export function UseMyLocation() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function locate() {
    if (!("geolocation" in navigator)) {
      setMessage("Your browser cannot share its location.");
      return;
    }
    setBusy(true);
    setMessage(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch("/api/geo/country", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          });
          const data = (await res.json().catch(() => ({}))) as { enabled?: boolean; country?: string; error?: string };
          if (data.enabled === false) setMessage("Location lookup is not available right now.");
          else if (!res.ok || !data.country) setMessage(data.error ?? "We could not work out your country.");
          else router.refresh();
        } catch {
          setMessage("We could not work out your country.");
        } finally {
          setBusy(false);
        }
      },
      (err) => {
        setBusy(false);
        setMessage(err.code === err.PERMISSION_DENIED ? "Location was not shared, so prices stay as shown." : "We could not get your location.");
      },
      { timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }

  return (
    <div className="mx-auto mb-8 flex max-w-2xl flex-col items-center gap-1 text-center text-sm text-muted">
      <button
        type="button"
        onClick={locate}
        disabled={busy}
        className="inline-flex items-center gap-1.5 font-semibold text-[color:var(--bp-link)] underline disabled:opacity-60"
      >
        <MapPin aria-hidden className="size-4" />
        {busy ? "Finding your country…" : "Use my location"}
      </button>
      <span>Your location is used once to pick your country and is not stored.</span>
      <span role="status" aria-live="polite">{message}</span>
    </div>
  );
}
