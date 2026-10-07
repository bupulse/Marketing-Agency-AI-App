"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Badge, Button, GlassCard, type BadgeTone } from "@/components/ui";
import { ConnectDialog } from "./connect-dialog";
import { DisconnectButton } from "./disconnect-button";
import { NetworkIcon } from "./network-icon";
import { canConnect, connectHref, primaryVariant, type AccountInfo, type ChannelInfo } from "./types";

const TYPE_LABEL: Record<string, string> = { business: "Business", creator: "Creator", personal: "Personal", page: "Page", member: "Profile", organization: "Organization", channel: "Channel" };

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
          <Button href={connectHref(account.network, account.network === "instagram" ? variant : undefined)} size="sm">
            Reconnect
          </Button>
        )}
        <DisconnectButton id={account.id} name={name} reminder={account.postingMode === "NOTIFY"} />
      </div>
    </li>
  );
}

/** One card per network: its connected accounts and a Connect button that opens the modal. */
export function ChannelList({ channels, accounts }: { channels: ChannelInfo[]; accounts: AccountInfo[] }) {
  const [open, setOpen] = useState<ChannelInfo | null>(null);
  return (
    <>
      <ul className="flex flex-col gap-4">
        {channels.map((channel) => {
          const mine = accounts.filter((a) => a.network === channel.network);
          return (
            <GlassCard as="li" key={channel.network} className="flex flex-col gap-3 rounded-card p-4 sm:p-5">
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
            </GlassCard>
          );
        })}
      </ul>
      {open && <ConnectDialog channel={open} onClose={() => setOpen(null)} />}
    </>
  );
}
