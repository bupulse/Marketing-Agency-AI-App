"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, Copy, Globe } from "lucide-react";
import { Badge, Button, GlassCard } from "@/components/ui";
import { installChatAction, removeChatAction } from "@/app/dashboard/domains/actions";

export type ZoneItem = { id: string; name: string; chat: "none" | "added" | "installed" };

/** The user's Cloudflare domains with an "Install chat" button each. */
export function ZoneList({ zones, snippet }: { zones: ZoneItem[]; snippet: string }) {
  const [state, setState] = useState<Record<string, ZoneItem["chat"]>>(() => Object.fromEntries(zones.map((z) => [z.id, z.chat])));
  const [note, setNote] = useState<Record<string, { text: string; manual?: boolean; error?: boolean }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const [copied, setCopied] = useState(false);

  const run = (zone: ZoneItem, action: "install" | "remove") => {
    setBusy(zone.id);
    setNote((n) => ({ ...n, [zone.id]: { text: "" } }));
    start(async () => {
      if (action === "install") {
        const res = await installChatAction(zone.id);
        if (!res.ok) setNote((n) => ({ ...n, [zone.id]: { text: res.error, error: true } }));
        else if (res.status === "manual") setNote((n) => ({ ...n, [zone.id]: { text: res.reason, manual: true } }));
        else {
          setState((s) => ({ ...s, [zone.id]: s[zone.id] === "installed" ? "installed" : "added" }));
          setNote((n) => ({ ...n, [zone.id]: { text: res.status === "already_installed" ? "The chat was already added. Nothing changed." : "Chat added. Open your website in a new tab to see it; this can take a minute." } }));
        }
      } else {
        const res = await removeChatAction(zone.id);
        if (res.ok) {
          setState((s) => ({ ...s, [zone.id]: "none" }));
          setNote((n) => ({ ...n, [zone.id]: { text: "Chat removed from this domain." } }));
        } else setNote((n) => ({ ...n, [zone.id]: { text: res.error ?? "Could not remove it.", error: true } }));
      }
      setBusy(null);
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The code is selectable on screen as well.
    }
  };

  if (zones.length === 0) return <GlassCard><p className="text-[14px] text-muted">No domains found in this Cloudflare account.</p></GlassCard>;

  return (
    <ul className="flex flex-col gap-3">
      {zones.map((zone) => {
        const chat = state[zone.id] ?? "none";
        const n = note[zone.id];
        return (
          <GlassCard as="li" key={zone.id} padding="sm" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-soft text-muted"><Globe className="size-5" /></span>
              <div className="flex min-w-0 flex-1 flex-col">
                <strong className="truncate">{zone.name}</strong>
                <span className="text-[13px] text-muted">
                  {chat === "installed" ? "Chat is live on this site" : chat === "added" ? "Chat added, waiting for the first visit" : "Chat not added"}
                </span>
              </div>
              {chat === "installed" && <Badge tone="success">Live</Badge>}
              {chat === "added" && <Badge tone="blue">Added</Badge>}
              {chat === "none" ? (
                <Button size="sm" onClick={() => run(zone, "install")} disabled={busy !== null}>{busy === zone.id ? "Adding…" : "Install chat"}</Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => run(zone, "remove")} disabled={busy !== null}>{busy === zone.id ? "Removing…" : "Remove"}</Button>
              )}
            </div>
            {n?.text && (
              <p role={n.error ? "alert" : "status"} className={n.error ? "text-[13px] text-danger" : "text-[13px] text-muted"}>{n.text}</p>
            )}
            {n?.manual && (
              <div className="flex flex-col gap-2">
                <p className="text-[13px]">Paste this just above the closing <code>&lt;/body&gt;</code> tag of your site (the allowed website is already set up):</p>
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-xl bg-soft p-3 text-[12px]">{snippet}</code>
                  <Button size="sm" variant="ghost" onClick={copy} leading={copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}>{copied ? "Copied" : "Copy"}</Button>
                </div>
                <Link href="/dashboard/widget" className="text-[13px] font-semibold text-pulse-blue">Step-by-step guides for WordPress, Wix, Shopify and more</Link>
              </div>
            )}
          </GlassCard>
        );
      })}
    </ul>
  );
}
