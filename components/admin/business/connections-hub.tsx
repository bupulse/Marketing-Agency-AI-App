// Admin -> Clients -> Connections, the landing page: one card per area (social channels, connectors, webhooks and API
// keys, website chat), with a card per network and per connector type to jump straight to that list. No data of its
// own: every card is a link to the matching filtered list (?tab=..., same URLs as before).
import Link from "next/link";
import { AlertTriangle, ArrowRight, Cloud, Code2, FolderOpen, MessageSquareText, Palette, Plug, ShieldOff, ShoppingBag, TimerReset, Webhook } from "lucide-react";
import { NetworkIcon } from "@/components/connections/network-icon";
import { CARD, FOCUS, LIFT, PageHeader, SectionCard, SectionGrid } from "@/components/admin/kit";
import { cn } from "@/lib/cn";

export const NETWORK_NAME: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", twitter: "X" };

const C = "/admin/connections";

function Heading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="px-1">
      <h2 className="text-[17px] font-bold tracking-[-0.02em]">{title}</h2>
      <p className="text-[13px] text-muted">{hint}</p>
    </div>
  );
}

/** A small card with a network's own logo, opening that network's accounts. */
function NetworkCard({ network }: { network: string }) {
  return (
    <Link href={`${C}?tab=channels&f1=${network}`} className={cn("group relative flex items-center gap-3 overflow-hidden p-3.5 text-text no-underline", CARD, LIFT, FOCUS)}>
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-brand-gradient opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
      <NetworkIcon network={network as Parameters<typeof NetworkIcon>[0]["network"]} className="size-9 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-bold leading-snug">{NETWORK_NAME[network]}</span>
        <span className="text-[12px] text-muted">Accounts</span>
      </span>
      <ArrowRight aria-hidden className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" />
    </Link>
  );
}

export function ConnectionsHub() {
  return (
    <>
      <PageHeader icon={Plug} tone="blue" title="Connections" description="Every client's social accounts, stores, developer tools and website chat. Pick an area; whatever you change here is saved in the audit log." />

      <section aria-label="Social channels" className="flex flex-col gap-3">
        <Heading title="Social channels" hint="The accounts clients post to. Open a network, or go straight to the ones with a problem." />
        <div className="kit-rise grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {Object.keys(NETWORK_NAME).map((n) => (
            <NetworkCard key={n} network={n} />
          ))}
        </div>
        <SectionGrid cols={4}>
          <SectionCard row href={`${C}?tab=channels`} icon={Plug} tone="blue" title="Every channel" hint="All networks together, newest first, with search." />
          <SectionCard row href={`${C}?tab=channels&f2=needs_reconnect`} icon={AlertTriangle} tone="red" title="Needs reconnect" hint="Posting stopped. The owner has to connect the account again." />
          <SectionCard row href={`${C}?tab=channels&f2=expired`} icon={ShieldOff} tone="red" title="Login expired" hint="The saved login ran out. Posts wait until they reconnect." />
          <SectionCard row href={`${C}?tab=channels&f2=expiring`} icon={TimerReset} tone="orange" title="Login expiring soon" hint="Still working, but the login ends soon. A reminder helps." />
        </SectionGrid>
      </section>

      <section aria-label="Connectors" className="flex flex-col gap-3">
        <Heading title="Connectors" hint="Stores, Cloudflare, Canva and file pickers. Disconnecting keeps what was imported." />
        <SectionGrid cols={4}>
          <SectionCard row href={`${C}?tab=connectors&kind=store`} icon={ShoppingBag} tone="green" title="Stores" hint="Shopify and WooCommerce: last sync, products and errors." />
          <SectionCard row href={`${C}?tab=connectors&kind=cloudflare`} icon={Cloud} tone="orange" title="Cloudflare" hint="Tokens and the chat-widget installs made with them." />
          <SectionCard row href={`${C}?tab=connectors&kind=canva`} icon={Palette} tone="violet" title="Canva" hint="Linked Canva accounts and how much they imported." />
          <SectionCard row href={`${C}?tab=connectors&kind=files`} icon={FolderOpen} tone="slate" title="Drive and Dropbox" hint="Files each client picked. Nothing to disconnect." />
        </SectionGrid>
      </section>

      <section aria-label="Developer tools and website chat" className="flex flex-col gap-3">
        <Heading title="Developer tools and website chat" hint="Webhooks and API keys (Pro plan), and the chat bubble on clients' websites." />
        <SectionGrid cols={4}>
          <SectionCard row href={`${C}?tab=webhooks`} icon={Webhook} tone="indigo" title="Webhooks and API keys" hint="Where events go, how often they fail, and the keys in use." />
          <SectionCard row href={`${C}?tab=webhooks&f1=failing`} icon={AlertTriangle} tone="red" title="Failing webhooks" hint="Endpoints that keep failing. Pause one if it is abused." />
          <SectionCard row href={`${C}?tab=widgets`} icon={MessageSquareText} tone="teal" title="Website chat" hint="Chats, leads, replies used and the abuse signal per site." />
          <SectionCard row href={`${C}?tab=widgets&f1=support_off`} icon={Code2} tone="slate" title="Chat switched off by support" hint="Widgets you switched off, and why. Switch them back on here." />
        </SectionGrid>
      </section>
    </>
  );
}
