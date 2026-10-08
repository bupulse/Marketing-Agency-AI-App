"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { cancelPendingAction, confirmPendingAction, disconnectStoreAction } from "@/app/dashboard/stores/actions";

// These run a server action and then do a full page load, rather than relying on the client router to apply a
// redirect: the page must show the new connection state, whatever the router's cache or prefetches are doing.
const go = (path: string) => window.location.assign(path);

export function DisconnectStoreButton({ provider }: { provider: string }) {
  const [busy, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={() =>
        start(async () => {
          await disconnectStoreAction(provider);
          go(`/dashboard/stores/${provider}`);
        })
      }
    >
      {busy ? "Disconnecting…" : "Disconnect"}
    </Button>
  );
}

/** "Connect <store>?" buttons for keys the store sent to BuPulse; nothing changes until the owner clicks Connect. */
export function PendingButtons({ pendingId }: { pendingId: string }) {
  const [busy, start] = useTransition();
  const [which, setWhich] = useState<"confirm" | "cancel" | null>(null);
  const run = (kind: "confirm" | "cancel") => {
    setWhich(kind);
    start(async () => {
      if (kind === "cancel") {
        await cancelPendingAction();
        return go("/dashboard/stores/woocommerce");
      }
      const res = await confirmPendingAction(pendingId);
      go(res.ok ? "/dashboard/stores/woocommerce?confirmed=1" : "/dashboard/stores/woocommerce?error=expired");
    });
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={busy} onClick={() => run("confirm")}>{busy && which === "confirm" ? "Connecting…" : "Connect this store"}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => run("cancel")}>{busy && which === "cancel" ? "Cancelling…" : "Cancel"}</Button>
    </div>
  );
}
