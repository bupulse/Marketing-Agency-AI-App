import type { AccountChoice, Network } from "./types";

// "Where should BuPulse post?": how the accounts of one sign-in are shown and which are ticked, and how a company's
// LinkedIn Page is named and put first wherever BuPulse picks an account for a network. Pure, so the Channels page,
// the callbacks and the posting code share the same rules.

/** A LinkedIn Page (company page), as opposed to the member's own profile. */
export const isCompanyPage = (network: string, accountType: string | null | undefined) => network === "linkedin" && accountType === "organization";

/**
 * Whether the sign-in ends on the picker. Several accounts always do. LinkedIn always does, even with only the
 * profile: the client then sees that no Page came back and why, instead of BuPulse quietly posting as the person.
 */
export function askWhereToPost(network: Network, accounts: readonly AccountChoice[]): boolean {
  return accounts.length > 1 || (network === "linkedin" && accounts.length > 0);
}

/** The picker's order: LinkedIn Pages first (they are what a business usually posts as), then the profile. */
export function orderChoices(network: Network, accounts: readonly AccountChoice[]): AccountChoice[] {
  return [...accounts].sort((a, b) => Number(isCompanyPage(network, b.accountType)) - Number(isCompanyPage(network, a.accountType)));
}

/**
 * The accounts ticked when the picker opens: the only account, or the only LinkedIn Page (not the profile next to
 * it). With several Pages the client ticks the ones they want.
 */
export function preselectedChoices(network: Network, accounts: readonly AccountChoice[]): string[] {
  if (accounts.length === 1) return [accounts[0].externalAccountId];
  const pages = accounts.filter((a) => isCompanyPage(network, a.accountType));
  return pages.length === 1 ? [pages[0].externalAccountId] : [];
}

/** The tag next to an account in the picker. */
export function choiceTag(network: Network, accountType: string): string | null {
  if (network !== "linkedin") return null;
  if (accountType === "organization") return "Company Page";
  if (accountType === "member") return "Your profile";
  return null;
}

/** True when a LinkedIn sign-in found no Page, so the picker explains how to get one. */
export function noLinkedInPage(network: Network, accounts: readonly AccountChoice[]): boolean {
  return network === "linkedin" && !accounts.some((a) => isCompanyPage(network, a.accountType));
}

/**
 * How an account is named in pickers and on post badges: "LinkedIn · <Page name>" for a LinkedIn Page, so it is
 * never mistaken for the person's profile; the account's own name (or the network's) otherwise.
 */
export function accountName(network: string, networkLabel: string, displayName: string | null | undefined, accountType: string | null | undefined): string {
  const name = displayName?.trim() || networkLabel;
  return isCompanyPage(network, accountType) && name !== networkLabel ? `${networkLabel} · ${name}` : name;
}

/** The name without the "LinkedIn · " in front, for an avatar's letter or next to the network's own name. */
export const bareName = (name: string, networkLabel: string) => (name.startsWith(`${networkLabel} · `) ? name.slice(networkLabel.length + 3) : name);

/**
 * Accounts with LinkedIn Pages ahead of LinkedIn profiles (otherwise in the same order), for code that takes the
 * first account of a network: a client who picked their Page gets the daily posts there, not on their profile.
 */
export function pagesFirst<T extends { provider: string; accountType?: string | null }>(rows: readonly T[]): T[] {
  // Only the LinkedIn accounts swap places among themselves: the other networks keep where they were.
  const linkedin = rows.filter((r) => r.provider === "linkedin");
  const reordered = [...linkedin.filter((r) => isCompanyPage(r.provider, r.accountType)), ...linkedin.filter((r) => !isCompanyPage(r.provider, r.accountType))];
  let next = 0;
  return rows.map((r) => (r.provider === "linkedin" ? reordered[next++] : r));
}
