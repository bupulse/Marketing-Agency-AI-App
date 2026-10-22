import "server-only";
import { prisma } from "@/lib/db";
import { accountFor, answerLines, anyNetworkLabel, factsOf, followerCheck, followerCheckInWords, matchState, storedAnswers, uploadAnswers, type AnswerLine, type CountedAccount, type MatchState } from "./applicant-facts";
import { readQuestions } from "./company-forms";
import { readApplicationForm } from "./form-fields";
import { mediaUrls } from "./media";
import { readRequirements } from "./requirements";

// The extra facts the company's Applicants and Creators lists show (docs/CREATOR_CAMPAIGN_WIZARD.md): each answer in
// words with uploads as signed links, the match against the campaign's requirements, and every account's followers,
// verified by the connected account once the creator has one. Read for rows the caller already loaded for its own
// company (listCampaignCreators, creatorTotals), so the campaign is looked up by id and company both.

export type AccountLine = { network: string; label: string; handle: string; followers: number | null; check: string | null; verified: boolean };
export type ApplicantDetails = { answers: AnswerLine[]; match: MatchState; accounts: AccountLine[] };

type Row = { id: string; profileId: string | null; handles: { network: string; handle: string; followers: number | null }[] };

/** The connected accounts (active, with a follower count read) of these creator profiles. */
async function countedAccounts(profileIds: string[]): Promise<Map<string, CountedAccount[]>> {
  const out = new Map<string, CountedAccount[]>();
  if (!profileIds.length) return out;
  const rows = await prisma.creatorConnection.findMany({ where: { profileId: { in: profileIds }, status: "ACTIVE" }, select: { profileId: true, network: true, username: true, displayName: true, followers: true } });
  for (const r of rows) out.set(r.profileId, [...(out.get(r.profileId) ?? []), r]);
  return out;
}

/** Each account in words: typed followers, and "Verified" or the difference once a connected account counted them. */
export function accountLines(handles: Row["handles"], accounts: CountedAccount[]): AccountLine[] {
  return handles.map((h) => {
    const check = followerCheck(h.followers, accountFor(h, accounts)?.followers);
    return { network: h.network, label: anyNetworkLabel(h.network), handle: h.handle, followers: h.followers, check: check ? followerCheckInWords(check) : null, verified: check?.kind === "verified" };
  });
}

/** Followers with connected counts taken over typed ones, for the follower requirement. */
const bestFollowers = (handles: Row["handles"], accounts: CountedAccount[]) => handles.map((h) => accountFor(h, accounts)?.followers ?? h.followers ?? 0);

/** The details of these rows of a campaign of `businessId`, by row id (empty when the campaign is not theirs). */
export async function applicantDetails(businessId: string, campaignId: string, rows: Row[]): Promise<Record<string, ApplicantDetails>> {
  const campaign = await prisma.creatorCampaign.findFirst({ where: { id: campaignId, businessId }, select: { applicationForm: true, questions: true, requirements: true, currency: true } });
  if (!campaign || !rows.length) return {};
  const form = readApplicationForm(campaign.applicationForm, readQuestions(campaign.questions));
  const req = readRequirements(campaign.requirements);
  const profileIds = [...new Set(rows.map((r) => r.profileId).filter((p): p is string => Boolean(p)))];
  const [stored, profiles, accounts] = await Promise.all([
    prisma.campaignCreator.findMany({ where: { campaignId, id: { in: rows.map((r) => r.id) } }, select: { id: true, answers: true } }),
    profileIds.length ? prisma.creatorProfile.findMany({ where: { id: { in: profileIds } }, select: { id: true, location: true } }) : Promise.resolve([]),
    countedAccounts(profileIds),
  ]);
  const answersOf = new Map(stored.map((s) => [s.id, storedAnswers(s.answers)]));
  const locationOf = new Map(profiles.map((p) => [p.id, p.location]));
  const urls = await mediaUrls(rows.flatMap((r) => uploadAnswers(form.fields, answersOf.get(r.id) ?? {})));

  const out: Record<string, ApplicantDetails> = {};
  for (const r of rows) {
    const answers = answersOf.get(r.id) ?? {};
    const own = r.profileId ? (accounts.get(r.profileId) ?? []) : [];
    out[r.id] = {
      answers: answerLines(form, answers, urls, campaign.currency),
      match: matchState(req, factsOf(form, answers, bestFollowers(r.handles, own), r.profileId ? locationOf.get(r.profileId) : null)),
      accounts: accountLines(r.handles, own),
    };
  }
  return out;
}

/** The accounts of joined creators in words (the Creators list), by row id. */
export async function joinedAccounts(rows: Row[]): Promise<Record<string, AccountLine[]>> {
  const accounts = await countedAccounts([...new Set(rows.map((r) => r.profileId).filter((p): p is string => Boolean(p)))]);
  return Object.fromEntries(rows.map((r) => [r.id, accountLines(r.handles, r.profileId ? (accounts.get(r.profileId) ?? []) : [])]));
}
