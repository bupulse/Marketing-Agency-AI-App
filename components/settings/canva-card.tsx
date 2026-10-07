import { Palette } from "lucide-react";
import { Badge, Button, buttonClasses, GlassCard } from "@/components/ui";
import { disconnectCanvaAction } from "@/app/dashboard/settings/canva-actions";
import { isCanvaEnabled } from "@/lib/canva/config";
import { isCanvaConnected } from "@/lib/canva/tokens";

/** Link or unlink the user's Canva account. Renders nothing unless the Canva integration is configured. */
export async function CanvaCard({ userId, next = "/dashboard/settings" }: { userId: string; next?: string }) {
  if (!isCanvaEnabled()) return null;
  const connected = await isCanvaConnected(userId);

  return (
    <GlassCard as="section" aria-labelledby="canva" className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:p-6">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-soft">
        <Palette aria-hidden className="size-5 text-muted" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="canva" className="text-lg font-semibold">
            Canva
          </h2>
          {connected ? <Badge tone="success">Connected</Badge> : <Badge tone="neutral">Not connected</Badge>}
        </div>
        <p className="text-sm text-muted">
          Open any BuPulse design in your own Canva account to edit it, then bring the result back here. BuPulse uploads
          the designs you send and reads back only those; it does not use anything else in your Canva account. You can
          disconnect at any time.
        </p>
      </div>
      {connected ? (
        <form action={disconnectCanvaAction}>
          <Button type="submit" variant="outline" size="sm">
            Disconnect
          </Button>
        </form>
      ) : (
        <a href={`/api/canva/connect?next=${encodeURIComponent(next)}`} className={buttonClasses({ size: "sm" })}>
          Connect Canva
        </a>
      )}
    </GlassCard>
  );
}
