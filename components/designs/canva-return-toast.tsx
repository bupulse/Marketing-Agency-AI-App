"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useToast, type ToastTone } from "@/components/ui";

const MESSAGES: Record<string, [string, ToastTone]> = {
  saved: ["Your edited design is saved. The original is still there too.", "success"],
  connected: ["Canva is connected. Press Edit in Canva again to open your design.", "success"],
  denied: ["Canva was not connected. You can try again any time.", "info"],
  processing: ["Your edit is still being saved. It will appear in your designs in a minute.", "info"],
  timeout: ["Canva is taking longer than usual. Please open the design in Canva again in a minute.", "error"],
  reconnect: ["Please connect Canva again, then retry.", "error"],
  error: ["We could not finish that with Canva. Please try again.", "error"],
};

/** Shows the result of a Canva connect or return (?canva=...) once, then clears it from the address. Mount on pages that start Canva flows. */
export function CanvaReturnToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const result = params.get("canva");

  useEffect(() => {
    if (!result) return;
    const message = MESSAGES[result];
    if (message) toast(message[0], message[1]);
    const rest = new URLSearchParams(params.toString());
    rest.delete("canva");
    rest.delete("design");
    router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
  }, [result, params, pathname, router, toast]);

  return null;
}
