import "server-only";
import { prisma } from "@/lib/db";
import { deleteConnectedAccount } from "@/lib/social/composio/client";
import type { AccountChoice, Network } from "@/lib/social/types";
import type { CreatorNetwork } from "./describe";
import type { CreatorAccount } from "./tracking/types";

// A creator's connected accounts (CreatorConnection, docs/CREATOR_CAMPAIGNS.md): made by the BuPulse-Socials sign-in
// (app/api/creator/[network]/callback), read by the tracking job. The Composio connected-account id is kept as it is:
// on its own it opens nothing, only BuPulse's Composio key can use it.

/**
 * Saves (or brings back) the account the sign-in gave. Connecting the same account again keeps its posts. Its follower
 * count, when the network gave one, verifies what the creator typed when applying (docs/CREATOR_CAMPAIGN_WIZARD.md).
 */
export async function saveCreatorConnection(profileId: string, network: CreatorNetwork, connectedAccountId: string, account: AccountChoice & Pick<CreatorAccount, "followers">, now = new Date()) {
  const where = { profileId_network_externalAccountId: { profileId, network, externalAccountId: account.externalAccountId } };
  const before = await prisma.creatorConnection.findUnique({ where, select: { composioConnectedAccountId: true } });
  const fields = { composioConnectedAccountId: connectedAccountId, username: account.displayName.slice(0, 120), displayName: account.displayName.slice(0, 120), accountType: account.accountType, avatarUrl: account.avatarUrl?.slice(0, 1000) ?? null, status: "ACTIVE", lastError: null, lastCheckedAt: now, ...(typeof account.followers === "number" ? { followers: account.followers, followersAt: now } : {}) };
  const saved = await prisma.creatorConnection.upsert({ where, create: { profileId, network, externalAccountId: account.externalAccountId, ...fields }, update: fields });
  // The earlier sign-in of this account is not needed any more (unless another of the creator's Pages still uses it).
  if (before && before.composioConnectedAccountId !== connectedAccountId) await dropIfUnused(network, before.composioConnectedAccountId);
  return saved;
}

async function dropIfUnused(network: string, composioConnectedAccountId: string) {
  const users = await prisma.creatorConnection.count({ where: { composioConnectedAccountId, status: "ACTIVE" } });
  if (!users) await deleteConnectedAccount(network as Network, composioConnectedAccountId);
}

/**
 * Disconnects an account. Its tracked posts keep their views so far; they stop earning 3 days later unless the same
 * account is connected again (owner decision), so the 3 days start now.
 */
export async function disconnectCreator(profileId: string, connectionId: string, now = new Date()): Promise<boolean> {
  const row = await prisma.creatorConnection.findFirst({ where: { id: connectionId, profileId }, select: { id: true, network: true, composioConnectedAccountId: true } });
  if (!row) return false;
  await prisma.creatorConnection.update({ where: { id: row.id }, data: { status: "REVOKED", lastCheckedAt: now } });
  await dropIfUnused(row.network, row.composioConnectedAccountId);
  return true;
}
