import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { readHandles, type ProfileInput } from "./profile-form";

// A creator's profile, /creator/profile (docs/CREATOR_MARKETPLACE.md, "Creator accounts"): filled once, it fills every
// one-tap application. Connected accounts (CreatorConnection) show as verified next to the typed handles.

/** The profile with its active connected accounts, for the profile page and one-tap applying. */
export async function loadProfile(profileId: string) {
  const row = await prisma.creatorProfile.findUnique({
    where: { id: profileId },
    select: {
      id: true,
      name: true,
      phone: true,
      location: true,
      bio: true,
      handles: true,
      samples: true,
      discoverable: true,
      blockedAt: true,
      connections: { where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { id: true, network: true, username: true, displayName: true } },
    },
  });
  return row ? { ...row, handles: readHandles(row.handles) } : null;
}

export type LoadedProfile = NonNullable<Awaited<ReturnType<typeof loadProfile>>>;

/** Saves the profile form (already read and checked by readProfileForm). */
export async function saveProfile(profileId: string, input: ProfileInput): Promise<void> {
  await prisma.creatorProfile.update({
    where: { id: profileId },
    data: {
      name: input.name,
      phone: input.phone,
      location: input.location,
      bio: input.bio,
      handles: input.handles as unknown as Prisma.InputJsonValue,
      samples: input.samples,
      discoverable: input.discoverable,
    },
  });
}
