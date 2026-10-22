"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui";
import { CONNECT_ERRORS, type ConnectErrorCode } from "@/lib/social/connect-errors";

const NAMES: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", twitter: "X" };

/** Shows the result of a connect (?connected=... or ?error=...) once, then clears it from the address. */
export function ConnectToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const connected = params.get("connected");
  const error = params.get("error");

  useEffect(() => {
    if (!connected && !error) return;
    if (connected) toast(`${NAMES[connected] ?? "Your account"} is connected.`, "success");
    else if (error) toast(CONNECT_ERRORS[error as ConnectErrorCode] ?? CONNECT_ERRORS.failed, error === "denied" ? "info" : "error");
    const rest = new URLSearchParams(params.toString());
    rest.delete("connected");
    rest.delete("error");
    router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
  }, [connected, error, params, pathname, router, toast]);

  return null;
}
