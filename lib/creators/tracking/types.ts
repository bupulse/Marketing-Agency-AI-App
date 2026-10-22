// What the creators' tracking reads from a network, the same for Instagram, Facebook Pages and TikTok, so the checks,
// the 6-hourly reading and the period close do not care which network a post is on (adapters.ts holds the
// differences).

import type { AccountChoice } from "@/lib/social/types";
import type { CreatorNetwork } from "../describe";
import type { ParsedLink } from "./links";

/** One post as the network has it, with its numbers (null: the network did not give that one). */
export type NetworkPost = {
  externalId: string;
  permalink: string | null;
  postedAt: Date | null;
  caption: string | null;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
};

/** Composio calls for one connected account; each one is reserved against the month's limit (caller.ts). */
export type Caller = {
  tool<T = Record<string, unknown>>(slug: string, args: Record<string, unknown>): Promise<T>;
  proxy<T = Record<string, unknown>>(request: { endpoint: string; method: "GET" | "POST"; body?: Record<string, unknown> }): Promise<T>;
};

/** The connected account being read: the network's id of it (Instagram user, Facebook Page, TikTok open_id). */
export type AccountRef = { network: CreatorNetwork; externalAccountId: string };

export type ReadResult = {
  /** Posts found, by external id. */
  found: Map<string, NetworkPost>;
  /** Posts the network says are gone (deleted, private, not on the account any more). */
  gone: string[];
};

/** An account a sign-in gives, with its follower count when the network gave it (docs/CREATOR_CAMPAIGN_WIZARD.md, "Followers"). */
export type CreatorAccount = AccountChoice & { followers?: number };

export type CreatorAdapter = {
  /** The accounts this sign-in gives (the Instagram professional account, the Facebook Pages, the TikTok account). */
  accounts(call: Caller): Promise<CreatorAccount[]>;
  /** The account's follower count now; null when the network does not give it (TikTok without user.info.stats). */
  followers?(call: Caller, account: AccountRef): Promise<number | null>;
  /** The post a link names, looked for on this account only (check 1); null when it is not there. `day` bounds the search. */
  find(call: Caller, account: AccountRef, link: ParsedLink, day: string): Promise<NetworkPost | null>;
  /** The numbers of these posts of the account, in as few calls as the network allows. */
  read(call: Caller, account: AccountRef, posts: { externalId: string; postedAt: Date | null }[]): Promise<ReadResult>;
};
