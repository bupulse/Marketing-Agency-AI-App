"use client";

import { Box, Cloud, Folder, Globe, HardDrive, Palette, Plug, ShoppingBag, ShoppingCart, Store, type LucideIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { disconnectConnector } from "@/app/dashboard/connectors/actions";
import { StatusPill, type PillTone } from "@/components/admin/kit/status-pill";
import { IconBadge } from "@/components/admin/kit/icon-badge";
import { CARD } from "@/components/admin/kit/tones";
import { Button, Dialog, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { buttonClasses } from "@/components/ui/button";
import type { CatalogItem } from "@/lib/connectors/catalog";
import { useHostHref } from "@/components/platform/hosts";

const ICONS: Record<string, LucideIcon> = { box: Box, cloud: Cloud, folder: Folder, globe: Globe, harddrive: HardDrive, palette: Palette, plug: Plug, shoppingbag: ShoppingBag, shoppingcart: ShoppingCart, store: Store };
// Entries name icons in any style ("hard-drive", "HardDrive"); compare without dashes and case.
const iconFor = (name: string): LucideIcon => ICONS[name.toLowerCase().replace(/[^a-z]/g, "")] ?? Plug;

const BADGE: Record<CatalogItem["status"]["state"], { tone: PillTone; label: string }> = {
  connected: { tone: "good", label: "Connected" },
  needs_attention: { tone: "bad", label: "Needs attention" },
  not_connected: { tone: "muted", label: "Not connected" },
  unavailable: { tone: "muted", label: "Coming soon" },
  not_in_plan: { tone: "new", label: "Add to your plan" },
};

/** OAuth start routes under /api must be real page loads: a client-side Link would prefetch them. */
function ConnectLink({ href, children, variant }: { href: string; children: string; variant: "primary" | "outline" }) {
  const className = buttonClasses({ variant, size: "sm" });
  // A connection's start route is on bupulse.com, where its callback is (docs/HOSTS.md).
  const toHref = useHostHref();
  if (href.startsWith("/api/")) return <a href={toHref(href)} className={className}>{children}</a>;
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
    <li className={cn(CARD, "flex flex-col gap-4 p-4 sm:p-5")} data-connector={item.id} data-state={state}>
      <div className="flex items-start gap-3">
        <IconBadge icon={iconFor(item.icon)} tone={state === "unavailable" ? "slate" : "blue"} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="font-semibold">{item.name}</h3>
            <StatusPill tone={badge.tone} dot={state === "connected" || state === "needs_attention"}>
              {badge.label}
            </StatusPill>
          </div>
          <p className="mt-1 text-[14px] leading-snug text-muted">{item.description}</p>
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
    </li>
  );
}
