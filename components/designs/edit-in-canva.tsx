"use client";

import { useState } from "react";
import { Button, useToast } from "@/components/ui";

type Props = {
  /** Id of the BuPulse design to edit. Must belong to the signed-in user. */
  designId: string;
  /** Pass `isCanvaEnabled()` from a server component. The button renders nothing when false. */
  enabled: boolean;
  /** Where to come back to after linking Canva for the first time. Defaults to the designs page. */
  connectNext?: string;
  className?: string;
};

type OpenResponse = { url?: string; error?: string; code?: string };

/**
 * "Edit in Canva" button. Sends the design to the user's Canva account and opens the editor in a new tab;
 * when they press "Return to BuPulse" in Canva, the edited image is saved as a new design.
 * If Canva is not linked yet (or access was removed) it sends the user through the connect flow first.
 */
export function EditInCanva({ designId, enabled, connectNext = "/dashboard/designs", className }: Props) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (!enabled) return null;

  async function open() {
    // Opened now, inside the click, so the browser does not block it as a pop-up while we wait for Canva.
    const tab = window.open("about:blank", "_blank");
    setBusy(true);
    try {
      const response = await fetch("/api/canva/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ designId }),
      });
      const data = (await response.json().catch(() => ({}))) as OpenResponse;
      if (response.ok && data.url) {
        if (tab) {
          tab.opener = null;
          tab.location.href = data.url;
        } else {
          window.location.href = data.url;
        }
        return;
      }
      tab?.close();
      if (data.code === "not_connected" || data.code === "reconnect") {
        // A full navigation: /api/canva/connect is a route handler that redirects to Canva, not a Next page.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(`/api/canva/connect?next=${encodeURIComponent(connectNext)}`);
        return;
      }
      toast(data.error ?? "We could not open Canva. Please try again.", "error");
    } catch {
      tab?.close();
      toast("We could not reach Canva. Check your connection and try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" className={className} onClick={open} disabled={busy} aria-busy={busy}>
      {busy ? "Opening Canva…" : "Edit in Canva"}
    </Button>
  );
}
