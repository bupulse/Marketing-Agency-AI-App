"use client";

import { Box, Cloud, Folder, Globe, HardDrive, Palette, Plug, ShoppingBag, ShoppingCart, Store, type LucideIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { disconnectConnector } from "@/app/dashboard/connectors/actions";
import { Badge, Button, Dialog, GlassCard, useToast, type BadgeTone } from "@/components/ui";
import { buttonClasses } from "@/components/ui/button";
import type { CatalogItem } from "@/lib/connectors/catalog";

const ICONS: Record<string, LucideIcon> = { box: Box, cloud: Cloud, folder: Folder, globe: Globe, harddrive: HardDrive, palette: Palette, plug: Plug, shoppingbag: ShoppingBag, shoppingcart: ShoppingCart, store: Store };
// Entries name icons in any style ("hard-drive", "HardDrive"); compare without dashes and case.
function ConnectorIcon({ name }: { name: string }) {
  const Icon = ICONS[name.toLowerCase().replace(/[^a-z]/g, "")] ?? Plug;
  return <Icon className="size-5" />;
}

const BADGE: Record<CatalogItem["status"]["state"], { tone: BadgeTone; label: string }> = {
  connected: { tone: "success", label: "Connected" },
  needs_attention: { tone: "danger", label: "Needs attention" },
  not_connected: { tone: "neutral", label: "Not connected" },
  unavailable: { tone: "neutral", label: "Coming soon" },
  not_in_plan: { tone: "violet", label: "Add to your plan" },
};

/** OAuth start routes under /api must be real page loads: a client-side Link would prefetch them. */
function ConnectLink({ href, children, variant }: { href: string; children: string; variant: "primary" | "outline" }) {
  const className = buttonClasses({ variant, size: "sm" });
  if (href.startsWith("/api/")) return <a href={href} className={className}>{children}</a>;
  return <Button href={href} variant={variant} size="sm">{children}</Button>;
}

export function ConnectorCard({ item }: { item: CatalogItem }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const { state, accountLabel, detail } = item.status;
  const badge = BADGE[state];
  const canDisconnect = state === "connected" || state === "needs_attention";

  function disconnect() {
    start(async () => {
      const result = await disconnectConnector(item.id);
      if (result.ok) {
        setOpen(false);
        toast(`${item.name} disconnected.`, "success");
      } else toast(result.error, "error");
    });
  }

  return (
    <GlassCard as="li" className="flex flex-col gap-4 rounded-card p-5" data-connector={item.id} data-state={state}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white">
          <ConnectorIcon name={item.icon} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="font-semibold">{item.name}</h3>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </div>
          <p className="mt-1 text-[14px] text-muted">{item.description}</p>
        </div>
      </div>
      {(accountLabel || detail) && (
        <p className={`text-[13px] break-words ${state === "needs_attention" ? "font-medium text-danger" : "text-muted"}`}>
          {[accountLabel, detail].filter(Boolean).join(" · ")}
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        {state === "unavailable" && (
          <Button variant="outline" size="sm" disabled>
            Connect
          </Button>
        )}
        {state === "not_in_plan" && item.manageHref && (
          <Button href={item.manageHref} variant="outline" size="sm">
            Add to your plan
          </Button>
        )}
        {state === "not_connected" && item.connectHref && <ConnectLink href={item.connectHref} variant="primary">Connect</ConnectLink>}
        {state === "needs_attention" && item.connectHref && <ConnectLink href={item.connectHref} variant="primary">Reconnect</ConnectLink>}
        {state === "connected" && item.manageHref && (
          <Button href={item.manageHref} variant="primary" size="sm">
            Open
          </Button>
        )}
        {canDisconnect && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-label={`Disconnect ${item.name}`}>
            Disconnect
          </Button>
        )}
      </div>
      {open && (
        <Dialog open onOpenChange={setOpen} title={`Disconnect ${item.name}?`} description="BuPulse will forget its access. What you already imported stays in BuPulse.">
          <p className="text-[15px] text-muted">You can connect {item.name} again any time.</p>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button size="sm" onClick={disconnect} disabled={pending} className="!bg-danger !bg-none !text-white !shadow-none">
              {pending ? "Disconnecting..." : "Disconnect"}
            </Button>
          </div>
        </Dialog>
      )}
    </GlassCard>
  );
}
