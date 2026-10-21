import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Search } from "lucide-react";
import { Button } from "@/components/ui";
import { ProfileForm, type ProfileFormValues } from "@/components/creators/portal/profile-form";
import { requireCreator } from "@/lib/creators/auth";
import { isCreatorNetwork, type CreatorNetwork } from "@/lib/creators/describe";
import { loadProfile } from "@/lib/creators/profile";

export const metadata: Metadata = { title: "Profile" };

// The creator's profile (docs/CREATOR_MARKETPLACE.md, "Creator accounts"): it fills every one-tap application.
// `?next=/c/<slug>`: they came from a campaign to complete it, and saving takes them back there.

export default async function ProfilePage({ searchParams }: PageProps<"/creator/profile">) {
  const query = await searchParams;
  const { profile: me } = await requireCreator();
  const profile = await loadProfile(me.id);
  if (!profile) notFound();
  const next = typeof query.next === "string" && /^\/c\/[a-z0-9-]{3,80}$/.test(query.next) ? query.next : null;

  const handles: ProfileFormValues["handles"] = {};
  for (const h of profile.handles) handles[h.network] = { handle: h.handle, followers: String(h.followers) };
  const verified: Partial<Record<CreatorNetwork, string>> = {};
  for (const c of profile.connections) if (isCreatorNetwork(c.network)) verified[c.network] ??= c.displayName ?? c.username ?? "Your account";
  const fresh = !profile.handles.length && !profile.samples.length;

  return (
    <>
      {next && (
        <Link href={next} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-muted no-underline hover:text-text">
          <ArrowLeft aria-hidden className="size-4" /> Back to the campaign
        </Link>
      )}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">Your profile</h1>
        <p className="text-[15px] text-muted">
          {fresh ? "Welcome! Fill this in once: it fills every application, so you apply to campaigns in one tap." : "It fills every application, so you apply to campaigns in one tap."}
        </p>
      </div>
      {profile.blockedAt && (
        <p role="alert" className="rounded-field bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
          Your account cannot apply to campaigns or be found by companies right now. Campaigns you already joined go on. Write to BuPulse if you think this is a mistake.
        </p>
      )}
      <ProfileForm
        next={next}
        verified={verified}
        profile={{ name: profile.name, phone: profile.phone ?? "", location: profile.location ?? "", bio: profile.bio ?? "", handles, samples: profile.samples, discoverable: profile.discoverable }}
      />
      <p className="text-[13px] text-muted">
        Connect your accounts on <Link href="/creator/connections" className="underline">Connections</Link>: connected accounts show as verified, and companies trust them more.
      </p>
      {!next && (
        <Button href="/creators" variant="outline" size="sm" leading={<Search aria-hidden className="size-4" />} className="self-start">
          Find campaigns
        </Button>
      )}
    </>
  );
}
