"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { CARD } from "@/components/admin/kit/tones";
import { Badge, Button, type BadgeTone } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ConnectDialog } from "./connect-dialog";
import { DisconnectButton } from "./disconnect-button";
import { InboxSwitch } from "./inbox-switch";
import { NetworkIcon } from "./network-icon";
import { canConnect, connectHref, primaryVariant, SOON_CHANNELS, type AccountInfo, type ChannelInfo } from "./types";
import { useHostHref } from "@/components/platform/hosts";

const TYPE_LABEL: Record<string, string> = { business: "Business", creator: "Creator", personal: "Personal", page: "Page", member: "Profile", profile: "Profile", organization: "Company Page", channel: "Channel" };

function status(a: AccountInfo): { label: string; tone: BadgeTone; reconnect: boolean } {
  if (a.postingMode === "NOTIFY") return { label: "Reminder posting", tone: "violet", reconnect: false };
  if (a.status === "ACTIVE") return { label: "Active", tone: "success", reconnect: false };
  if (a.status === "EXPIRING") return { label: "Expires soon", tone: "neutral", reconnect: true };
  return { label: "Needs reconnect", tone: "danger", reconnect: true };
}

function AccountAvatar({ account, name }: { account: AccountInfo; name: string }) {
  return account.avatarUrl ? (
    // Avatars come from each network's CDN, which next/image would need allow-listed one by one.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={account.avatarUrl} alt="" width={44} height={44} referrerPolicy="no-referrer" className="size-11 shrink-0 rounded-full object-cover" />
  ) : (
    <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-soft text-sm font-semibold text-muted">
      {name.replace(/^@/, "").slice(0, 2).toUpperCase()}
    </span>
  );
}

function AccountRow({ account, variant }: { account: AccountInfo; variant?: string }) {
  const name = account.displayName ?? account.externalAccountId;
  const s = status(account);
  // Connections start on bupulse.com, where their callbacks are (docs/HOSTS.md): an absolute link from the Marketing host.
  const toHref = useHostHref();
  return (
    <li className="flex animate-pop flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3">
      <AccountAvatar account={account} name={name} />
      <div className="min-w-0 flex-1 basis-40">
        <p className="truncate font-semibold">{name}</p>
        <p className="truncate text-[13px] text-muted">{TYPE_LABEL[account.accountType ?? ""] ?? account.accountType ?? "Account"}</p>
      </div>
      <Badge tone={s.tone}>{s.label}</Badge>
      <div className="flex items-center gap-2">
        {s.reconnect && (
          <Button href={toHref(connectHref(account.network, account.network === "instagram" ? variant : undefined))} size="sm">
            Reconnect
          </Button>
        )}
        <DisconnectButton id={account.id} name={name} reminder={account.postingMode === "NOTIFY"} />
      </div>
      {account.inbox && <InboxSwitch id={account.id} name={name} inbox={account.inbox} />}
    </li>
  );
}

/** One card per network: its connected accounts and a Connect button that opens the modal. */
export function ChannelList({ channels, accounts }: { channels: ChannelInfo[]; accounts: AccountInfo[] }) {
  const [open, setOpen] = useState<ChannelInfo | null>(null);
  return (
    <>
      <ul className="kit-rise grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
        {channels.map((channel) => {
          const mine = accounts.filter((a) => a.network === channel.network);
          return (
            <li key={channel.network} className={cn(CARD, "flex flex-col gap-3 p-4 sm:p-5", mine.length > 0 && "border-pulse-blue/30")}>
              <div className="flex items-center gap-3">
                <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center">
                  <NetworkIcon network={channel.network} className="size-9" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{channel.label}</p>
                  <p className="truncate text-[13px] text-muted">{channel.note}</p>
                </div>
                {canConnect(channel) ? (
                  <Button type="button" size="sm" variant={mine.length ? "outline" : "primary"} leading={<Plus aria-hidden className="size-4" />} onClick={() => setOpen(channel)}>
                    {mine.length ? "Add" : "Connect"}
                  </Button>
                ) : (
                  <Badge tone="neutral">Coming soon</Badge>
                )}
              </div>
              {mine.length > 0 && (
                <ul className="flex flex-col gap-3" aria-label={`${channel.label} accounts`}>
                  {mine.map((a) => (
                    <AccountRow key={a.id} account={a} variant={channel.network === "instagram" ? primaryVariant(channel) : undefined} />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {SOON_CHANNELS.length > 0 && (
        <div className={cn(CARD, "flex flex-col gap-3 p-4 sm:p-5")}>
          <p className="text-[14px] font-semibold">
            Coming soon <span className="font-normal text-muted">· more networks on the way</span>
          </p>
          <ul className="flex flex-wrap gap-2">
            {SOON_CHANNELS.map((soon) => (
              <li key={soon.id} title={soon.note} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-soft px-3 text-[13px] font-semibold">
                <NetworkIcon network={soon.id} className="size-5" />
                {soon.label}
              </li>
            ))}
          </ul>
        </div>
      )}
      {open && <ConnectDialog channel={open} onClose={() => setOpen(null)} />}
    </>
  );
}
