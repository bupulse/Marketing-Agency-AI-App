"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui";
import { disconnectCloudflareAction } from "@/app/dashboard/domains/actions";

const go = (path: string) => window.location.assign(path);

/** Forgets the token, then reloads the page so it shows the connect steps (a full load, not a router redirect). */
export function DisconnectCloudflareButton() {
  const [busy, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={() =>
        start(async () => {
          await disconnectCloudflareAction();
          go("/dashboard/domains");
        })
      }
    >
      {busy ? "Disconnecting…" : "Disconnect"}
    </Button>
  );
}
