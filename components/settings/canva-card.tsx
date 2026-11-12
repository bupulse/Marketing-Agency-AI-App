import { Palette } from "lucide-react";
import { StatusPill } from "@/components/admin/kit";
import { BPanel } from "@/components/app/kit/b-cards";
import { Button, buttonClasses } from "@/components/ui";
import { disconnectCanvaAction } from "@/app/dashboard/settings/canva-actions";
import { isCanvaEnabled } from "@/lib/canva/config";
import { isCanvaConnected } from "@/lib/canva/tokens";

/** Link or unlink the user's Canva account. Renders nothing unless the Canva integration is configured. */
export async function CanvaCard({ userId, next = "/dashboard/settings" }: { userId: string; next?: string }) {
  if (!isCanvaEnabled()) return null;
  const connected = await isCanvaConnected(userId);

  return (
    <BPanel
      id="canva"
      icon={Palette}
      tone="violet"
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          Canva
          {connected ? (
            <StatusPill tone="good" dot>
              Connected
            </StatusPill>
          ) : (
            <StatusPill tone="muted">Not connected</StatusPill>
          )}
        </span>
      }
      hint="Open any BuPulse design in your own Canva account to edit it, then bring it back here. BuPulse reads back only the designs you send. Disconnect any time."
      aside={
        connected ? (
          <form action={disconnectCanvaAction}>
            <Button type="submit" variant="outline" size="sm">
              Disconnect
            </Button>
          </form>
        ) : (
          <a href={`/api/canva/connect?next=${encodeURIComponent(next)}`} className={buttonClasses({ size: "sm" })}>
            Connect Canva
          </a>
        )
      }
    />
  );
}
