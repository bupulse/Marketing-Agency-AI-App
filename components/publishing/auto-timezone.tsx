"use client";

import { useEffect } from "react";
import { autoSetTimezoneAction } from "@/app/dashboard/calendar/actions";
import { browserZone } from "./helpers";

const KEY = "bupulse-auto-timezone";

/**
 * Renders nothing. While the business is still on "UTC", saves the browser's time zone once.
 * It does not refresh the page: a refresh landing after the user clicked a link would pull them
 * back to the page they left. Pages that show times read the zone fresh on their next load.
 */
export function AutoTimezone({ current }: { current: string }) {
  useEffect(() => {
    if (current !== "UTC") return;
    const zone = browserZone();
    if (!zone || zone === "UTC" || zone === "Etc/UTC") return;
    try {
      if (sessionStorage.getItem(KEY)) return;
    } catch {
      // Without storage it just tries once per page load.
    }
    // Remembered only after it saved: a call cut short by leaving the page is tried again on the next one.
    void autoSetTimezoneAction(zone).then((res) => {
      if (!res.ok) return;
      try {
        sessionStorage.setItem(KEY, "1");
      } catch {
        // Ignore: the business is no longer on "UTC", so the next page skips it anyway.
      }
    });
  }, [current]);
  return null;
}
