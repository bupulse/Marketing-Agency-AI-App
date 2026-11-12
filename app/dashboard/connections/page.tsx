import { Suspense } from "react";
import { cookies } from "next/headers";
import { featureGate, pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { ConnectionsView, type ConnectionsTab } from "@/components/connections/connections-view";
import { getCatalog } from "@/lib/connectors/catalog";
import { CanvaCard } from "@/components/settings/canva-card";
import { isCanvaEnabled } from "@/lib/canva/config";
import { CanvaReturnToast } from "@/components/designs/canva-return-toast";
import { AccountPicker } from "@/components/connections/account-picker";
import { ConnectToast } from "@/components/connections/connect-toast";
import type { AccountInfo, ChannelInfo } from "@/components/connections/types";
import { listConnections } from "@/lib/social/connections";
import { openPending } from "@/lib/social/oauth";
import { isInstagramViaFacebookConfigured } from "@/lib/social/providers/instagram";
import { allProviders, isNetwork } from "@/lib/social/registry";
import { viaComposio } from "@/lib/social/composio/client";
import { tiktokDirectPost } from "@/lib/social/composio/ways";
import { isUploadPostResult, viaUploadPost } from "@/lib/social/uploadpost/ways";
import { viaZernio } from "@/lib/social/zernio/ways";
import type { Network } from "@/lib/social/types";
import { disabledNetworks, isServiceEnabled } from "@/lib/admin/switch";
import { inboxStates } from "@/lib/social/inbox/accounts";

export const metadata = { title: "Channels" };

const NOTES: Record<string, string> = {
  instagram: "Business and Creator accounts",
  facebook: "Facebook Pages",
  linkedin: "Profiles and Pages",
  tiktok: "Videos",
  youtube: "Videos and Shorts",
  twitter: "Posts, photos and videos",
};

/** The extra line in the Connect window for networks that work a little differently through BuPulse-Socials, Upload-Post or Zernio. */
function detailFor(network: Network, composio: boolean, uploadPost: boolean, zernio = false): string | undefined {
  if (zernio && network === "tiktok") return "BuPulse posts your videos and photo posts to your TikTok at the time you choose, for everyone to see. Your TikTok account must be public for videos.";
  if (uploadPost && network === "tiktok") return "BuPulse posts your videos and photo posts at the time you choose, for everyone to see (a private TikTok account keeps its own setting).";
  if (!composio) return undefined;
  if (network === "tiktok") return tiktokDirectPost() ? "BuPulse posts your videos at the time you choose. Photo posts come to you as reminders." : "At the time you choose, BuPulse sends your video to your TikTok inbox. Open TikTok, tap the notification, add the caption and post. Photo posts come to you as reminders.";
  if (network === "twitter") return "BuPulse posts text with up to 4 photos, or one MP4 video. Views and likes come in your reports about once a week.";
  return undefined;
}

export default async function ConnectionsPage({ searchParams }: PageProps<"/dashboard/connections">) {
  const blocked = (await pageGate("channels")) ?? (await featureGate("calendar"));
  if (blocked) return blocked;
  const { user, actorId, business, entitlements } = await getAppContext();
  const social = business ? await listConnections(business.id) : [];
  // The apps are the connectors' real state (lib/connectors/catalog.ts): Connect where it works, "Coming soon" only
  // where BuPulse's own keys are not set, "Add to your plan" where the plan lacks the feature. Canva has its own card above.
  const apps = business ? (await getCatalog({ userId: actorId, businessId: business.id, features: entitlements.inPlan })).filter((a) => a.id !== "canva" || !isCanvaEnabled()) : [];

  // BuPulse-Socials (Composio) replaces BuPulse's own apps where it is on; switched off in Admin -> Services, those
  // networks fall back to their own apps (or "Coming soon" when those are not set up). TikTok and X go through it once
  // BuPulse's own TikTok and X apps are added in Composio. A network switched off in Admin -> Services (X is off until
  // the owner switches it on: it costs per post) shows "Coming soon" too.
  // LinkedIn and TikTok go through Upload-Post instead once its key is set (lib/social/uploadpost; TikTok also needs
  // UPLOAD_POST_TIKTOK), unless it is switched off. TikTok goes through Zernio ahead of all of them once its key is set
  // (lib/social/zernio), unless it is switched off.
  const [composioOn, uploadPostOn, zernioOn, offNetworks] = await Promise.all([isServiceEnabled("composio"), isServiceEnabled("uploadpost"), isServiceEnabled("zernio"), disabledNetworks()]);
  const channels: ChannelInfo[] = allProviders().map((p) => {
    const off = offNetworks.includes(p.network);
    const zernio = !off && zernioOn && viaZernio(p.network);
    const uploadPost = !off && !zernio && uploadPostOn && viaUploadPost(p.network);
    const composio = !off && !zernio && !uploadPost && composioOn && viaComposio(p.network);
    return {
      network: p.network,
      label: p.rules.label,
      note: NOTES[p.network] ?? "",
      configured: !off && (zernio || uploadPost || composio || p.isConfigured()),
      viaFacebook: p.network === "instagram" && !composio && !off ? isInstagramViaFacebookConfigured() : undefined,
      viaComposio: composio || undefined,
      viaUploadPost: uploadPost || undefined,
      viaZernio: zernio || undefined,
      detail: detailFor(p.network, composio, uploadPost, zernio),
    };
  });
  // Instagram and Facebook accounts carry the "Answer comments and messages" switch (lib/social/inbox/accounts.ts).
  const inbox = business ? await inboxStates(business.id, entitlements.inPlan.has("inbox")) : {};
  const accounts: AccountInfo[] = social.map((a) => ({ id: a.id, network: a.network, displayName: a.displayName, externalAccountId: a.externalAccountId, accountType: a.accountType, avatarUrl: a.avatarUrl, status: a.status, postingMode: a.postingMode, inbox: inbox[a.id] }));

  // After OAuth with several accounts, the encrypted cookie holds them until the user picks.
  const sp = await searchParams;
  const pick = sp.pick;
  const store = await cookies();
  const pending = typeof pick === "string" && isNetwork(pick) ? await openPending((name) => store.get(name)?.value, user.id) : null;
  const picking = pending && pending.network === pick ? pending : null;
  // Social accounts first; the Apps tab on ?show=apps, and when coming back from Canva.
  const tab: ConnectionsTab = sp.show === "apps" || (typeof sp.canva === "string" && !picking) ? "apps" : "social";

  return (
    <ConnectionsView
      tab={tab}
      params={sp}
      channels={channels}
      accounts={accounts}
      apps={apps}
      toasts={
        <>
          <Suspense>
            <ConnectToast />
          </Suspense>
          <Suspense>
            <CanvaReturnToast />
          </Suspense>
        </>
      }
      picker={
        picking ? (
          <AccountPicker
            network={picking.network}
            label={channels.find((c) => c.network === picking.network)?.label ?? ""}
            accounts={picking.result.accounts}
            pageAccess={isUploadPostResult(picking.result.scopes)}
          />
        ) : null
      }
      canva={tab === "apps" ? <CanvaCard userId={actorId} next="/dashboard/connections?show=apps" /> : null}
    />
  );
}
