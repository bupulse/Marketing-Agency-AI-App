import "server-only";
import { pollLimit } from "@/lib/social/inbox/budget";
import { getInboxSettings } from "@/lib/social/inbox/settings";
import { composioReady } from "@/lib/social/inbox/transport";
import { composioCreatorId } from "../auth";
import type { CreatorNetwork } from "../describe";
import { creatorAdapter } from "./adapters";
import { composioCaller } from "./caller";
import { resolvePosts } from "./resolve";

/** A hand-in's links checked right away (at most 20 s); what is left stays CHECKING for the 6-hourly job. */
export async function checkHandedIn(postIds: string[]): Promise<{ tracking: number; invalid: number; waiting: number }> {
  if (!(await composioReady())) return { tracking: 0, invalid: 0, waiting: postIds.length };
  const limit = pollLimit((await getInboxSettings()).monthlyCap);
  const r = await resolvePosts(
    postIds,
    { adapter: creatorAdapter, caller: (c) => composioCaller(c.network as CreatorNetwork, c.composioConnectedAccountId, composioCreatorId(c.profileId), limit) },
    Date.now() + 20_000,
  );
  return { tracking: r.tracking, invalid: r.invalid, waiting: postIds.length - r.tracking - r.invalid };
}
