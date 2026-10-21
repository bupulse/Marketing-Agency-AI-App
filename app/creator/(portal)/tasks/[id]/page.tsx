import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { GlassCard } from "@/components/ui";
import { HandInForm } from "@/components/creators/portal/hand-in-form";
import { PostStatus } from "@/components/creators/portal/post-status";
import { requireCreator } from "@/lib/creators/auth";
import { formatDay, isCreatorNetwork, listWords, networkLabel, taskRuleInWords } from "@/lib/creators/describe";
import { taskForCreator } from "@/lib/creators/handin";
import { mediaUrls } from "@/lib/creators/media";
import { dayIn } from "@/lib/creators/periods";
import { handInDays, MAX_FILES, MAX_FILE_BYTES } from "@/lib/creators/tasks";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Hand in" };

export default async function TaskPage({ params, searchParams }: PageProps<"/creator/tasks/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { profile } = await requireCreator();
  const loaded = await taskForCreator(profile.id, id);
  if (!loaded) notFound();
  const { task, membership, timeZone } = loaded;
  const today = dayIn(new Date(), timeZone);
  const days = handInDays(task, today);
  const asked = typeof query.day === "string" ? query.day : "";
  const day = days.includes(asked) ? asked : (days.at(-1) ?? "");

  const [submissions, connections] = await Promise.all([
    day ? prisma.creatorSubmission.findMany({ where: { taskId: task.id, campaignCreatorId: membership.id, day: new Date(`${day}T00:00:00Z`) }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, mediaPaths: true, posts: { select: { id: true, network: true, url: true, status: true, statusReason: true } } } }) : [],
    prisma.creatorConnection.findMany({ where: { profileId: profile.id, status: "ACTIVE" }, select: { network: true } }),
  ]);
  const counting = submissions.filter((s) => s.posts.some((p) => p.status !== "INVALID")).length;
  const left = Math.max(0, task.postsPerDay - counting);
  const open = membership.status === "JOINED" && task.campaign.status === "LIVE";
  const connected = new Set(connections.map((c) => c.network));
  const platforms = task.platforms.filter(isCreatorNetwork);
  // ALL: every platform must be connected; ANY: one is enough to hand in.
  const missing = platforms.filter((n) => !connected.has(n));
  const notConnected = task.platformMode === "ALL" || missing.length === platforms.length ? missing : [];
  const thumbs = await mediaUrls(submissions.flatMap((s) => s.mediaPaths.slice(0, 1)), 15 * 60).catch(() => new Map<string, string>());

  return (
    <>
      <Link href={`/creator/tasks?campaign=${task.campaignId}`} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-muted no-underline hover:text-text">
        <ArrowLeft aria-hidden className="size-4" /> {task.campaign.name}
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-[-0.03em]">{task.title}</h1>
        <p className="text-sm text-muted">{taskRuleInWords(task)}</p>
      </div>
      <GlassCard padding="none" className="flex flex-col gap-2 p-4">
        <p className="whitespace-pre-wrap text-[15px]">{task.instructions}</p>
        {task.campaign.mentions.length > 0 && <p className="text-sm font-medium">The caption must include {task.campaign.mentions.length > 1 ? `one of ${listWords(task.campaign.mentions, "or")}` : task.campaign.mentions[0]}.</p>}
        {task.campaign.rules && <p className="whitespace-pre-wrap text-sm text-muted">{task.campaign.rules}</p>}
      </GlassCard>

      {days.length > 1 && (
        <nav aria-label="Day" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {days.slice(-7).reverse().map((d) => (
            <Link key={d} href={`/creator/tasks/${task.id}?day=${d}`} aria-current={d === day ? "page" : undefined} className={`inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-semibold no-underline ${d === day ? "bg-brand-gradient text-white" : "glass text-text"}`}>
              {d === today ? "Today" : formatDay(d, false)}
            </Link>
          ))}
        </nav>
      )}

      {submissions.length > 0 && (
        <section aria-labelledby="handed" className="flex flex-col gap-3">
          <h2 id="handed" className="text-lg font-semibold tracking-tight">Handed in for {day === today ? "today" : formatDay(day)}</h2>
          {submissions.map((s) => (
            <GlassCard key={s.id} padding="none" className="flex gap-3 p-4">
              {thumbs.get(s.mediaPaths[0]) && /\.(jpe?g|png|webp)$/i.test(s.mediaPaths[0]) && (
                // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed Storage URL
                <img src={thumbs.get(s.mediaPaths[0])} alt="" className="size-16 shrink-0 rounded-xl object-cover" />
              )}
              <div className="flex min-w-0 flex-col gap-2">
                <p className="text-[15px] font-semibold">{s.title}</p>
                {s.posts.map((p) => (
                  <div key={p.id} className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm">
                      <PostStatus status={p.status} /> {networkLabel(p.network)}
                    </span>
                    {p.statusReason && <span className="text-sm text-muted">{p.statusReason}</span>}
                  </div>
                ))}
              </div>
            </GlassCard>
          ))}
        </section>
      )}

      {!open ? (
        <p role="status" className="rounded-field bg-soft px-4 py-3 text-sm font-medium">{membership.status !== "JOINED" ? "You are no longer in this campaign." : "Hand-ins are closed for this campaign."}</p>
      ) : !day ? (
        <p className="text-[15px] text-muted">This task starts on {formatDay(String(task.startsOn.toISOString()).slice(0, 10))}.</p>
      ) : left === 0 ? (
        <p role="status" className="rounded-field bg-success-bg px-4 py-3 text-sm font-medium text-success">Done for {day === today ? "today" : formatDay(day)}.</p>
      ) : (
        <HandInForm
          taskId={task.id}
          day={day}
          platforms={platforms}
          platformMode={task.platformMode}
          mediaKind={task.mediaKind}
          notConnected={notConnected}
          maxFiles={MAX_FILES}
          maxBytes={MAX_FILE_BYTES}
          left={left}
        />
      )}
    </>
  );
}
