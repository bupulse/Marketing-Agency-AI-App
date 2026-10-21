import "server-only";
import { prisma } from "@/lib/db";
import { isCreatorNetwork, NETWORK_LABEL } from "./describe";
import { checkUploads, uploadTargets, type UploadRequest, type UploadTarget } from "./media";
import { dayIn } from "./periods";
import { CAPTION_MAX, coversDay, handInKey, linksProblem, TITLE_MAX, URL_MAX } from "./tasks";
import { handedInCounts } from "./portal";
import { networkOfLink, parsePostLink } from "./tracking/links";

// Handing in a task for a day (docs/CREATOR_CAMPAIGNS.md, "Campaigns, tasks and days"): the title, the caption, the
// uploaded files and one link per platform, as one CreatorSubmission with one CreatorPost (CHECKING) per link.
// Auto-approved (owner decision); the links are checked right after (tracking/resolve.ts).

export class HandInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandInError";
  }
}

/** The task with the creator's membership of its campaign, when they may hand it in (joined, campaign live). */
export async function taskForCreator(profileId: string, taskId: string) {
  const task = await prisma.creatorTask.findUnique({
    where: { id: taskId },
    include: { campaign: { select: { id: true, name: true, status: true, rules: true, mentions: true, platforms: true, business: { select: { name: true, timezone: true } } } } },
  });
  if (!task) return null;
  const membership = await prisma.campaignCreator.findFirst({ where: { campaignId: task.campaignId, profileId, status: { in: ["JOINED", "REMOVED"] } }, select: { id: true, status: true } });
  if (!membership) return null;
  return { task, membership, timeZone: task.campaign.business.timezone || "UTC" };
}

type Loaded = NonNullable<Awaited<ReturnType<typeof taskForCreator>>>;

function assertOpen(t: Loaded) {
  if (t.membership.status !== "JOINED") throw new HandInError("You are no longer in this campaign.");
  if (t.task.campaign.status !== "LIVE") throw new HandInError(t.task.campaign.status === "PAUSED" ? "The company paused this campaign: hand-ins are closed for now." : "This campaign is not open for hand-ins.");
}

export async function startUploads(profileId: string, taskId: string, files: UploadRequest[]): Promise<UploadTarget[]> {
  const t = await taskForCreator(profileId, taskId);
  if (!t) throw new HandInError("That task was not found.");
  assertOpen(t);
  return uploadTargets(profileId, t.task.campaignId, t.task.mediaKind, files);
}

export type HandInInput = { taskId: string; day: string; title: string; caption: string; mediaPaths: string[]; links: Record<string, string> };

/** Saves a hand-in and returns its post ids (CHECKING), for the caller to check. Throws HandInError for the creator. */
export async function handIn(profileId: string, input: HandInInput, now = new Date()): Promise<{ submissionId: string; postIds: string[] }> {
  const t = await taskForCreator(profileId, input.taskId);
  if (!t) throw new HandInError("That task was not found.");
  assertOpen(t);
  const { task, membership, timeZone } = t;
  const today = dayIn(now, timeZone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day) || !coversDay(task, input.day)) throw new HandInError("Pick a day of this task.");
  if (input.day > today) throw new HandInError("You can hand in a day's task on that day, not before.");

  const title = input.title.trim().slice(0, TITLE_MAX);
  const caption = input.caption.trim().slice(0, CAPTION_MAX);
  if (!title) throw new HandInError("Give it a title.");
  if (!caption) throw new HandInError("Paste the caption you used.");

  const links: Record<string, string> = {};
  for (const [network, raw] of Object.entries(input.links)) {
    const url = raw.trim();
    if (!url) continue;
    if (url.length > URL_MAX) throw new HandInError("That link is too long.");
    if (!isCreatorNetwork(network)) throw new HandInError("That platform is not part of this task.");
    if (!parsePostLink(network, url)) {
      const other = networkOfLink(url);
      throw new HandInError(other && other !== network ? `The ${NETWORK_LABEL[network]} box has a ${NETWORK_LABEL[other]} link.` : `That is not a link to a post on ${NETWORK_LABEL[network]}. Open the post, tap Share, copy the link and paste it here.`);
    }
    links[network] = url;
  }
  const problem = linksProblem(task, links);
  if (problem) throw new HandInError(problem);

  const missing = [];
  for (const network of Object.keys(links)) {
    if (!(await prisma.creatorConnection.findFirst({ where: { profileId, network, status: "ACTIVE" }, select: { id: true } }))) missing.push(NETWORK_LABEL[network as keyof typeof NETWORK_LABEL]);
  }
  if (missing.length) throw new HandInError(`Connect your ${missing.join(" and ")} in Connections first: BuPulse reads your views from it.`);

  const counts = await handedInCounts([membership.id], [new Date(`${input.day}T00:00:00Z`)]);
  if ((counts.get(`${membership.id}|${handInKey(task.id, input.day)}`) ?? 0) >= task.postsPerDay) {
    throw new HandInError(task.postsPerDay === 1 ? "You already handed in this task for that day." : `You already handed in ${task.postsPerDay} posts for this task that day.`);
  }

  const mediaPaths = await checkUploads(profileId, task.campaignId, task.mediaKind, input.mediaPaths).catch((error: Error) => {
    throw new HandInError(error.message);
  });
  if (!mediaPaths.length) throw new HandInError(task.mediaKind === "IMAGE" ? "Add the photos you posted." : "Add the video you posted.");

  const submission = await prisma.creatorSubmission.create({
    data: {
      campaignId: task.campaignId,
      taskId: task.id,
      campaignCreatorId: membership.id,
      day: new Date(`${input.day}T00:00:00Z`),
      title,
      caption,
      mediaPaths,
      posts: { create: Object.entries(links).map(([network, url]) => ({ campaignId: task.campaignId, campaignCreatorId: membership.id, network, url })) },
    },
    select: { id: true, posts: { select: { id: true } } },
  });
  return { submissionId: submission.id, postIds: submission.posts.map((p) => p.id) };
}
