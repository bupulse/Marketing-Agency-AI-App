import { ImagePlus, Mail } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Network } from "@/lib/social/types";
import { AccountAvatar, networkName } from "./network-icon";
import { MediaThumb } from "@/components/visuals/media-thumb";

type Props = {
  network: Network;
  accountName: string;
  avatarUrl?: string | null;
  text: string;
  hashtags: string[];
  media: { url: string }[];
  /** A reminder post: the network cannot be posted to by BuPulse, so we show what the email will hold. */
  reminder?: boolean;
  needsMedia?: boolean;
  /** Hide the "we email you" note, for posts that already exist. */
  hideReminderNote?: boolean;
  className?: string;
};

function Images({ media, ratio }: { media: { url: string }[]; ratio: string }) {
  if (media.length === 0) return null;
  const shown = media.slice(0, 4);
  return (
    <div className={cn("relative grid gap-0.5 overflow-hidden bg-soft", shown.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
      {shown.map((m) => (
        <MediaThumb key={m.url} url={m.url} loading="lazy" className={cn("w-full object-cover", shown.length > 1 ? "aspect-square" : ratio)} />
      ))}
      {media.length > 4 && <span className="absolute right-2 bottom-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">+{media.length - 4}</span>}
    </div>
  );
}

/** A rough picture of how the post will look on its network, updated as the owner types. */
export function PostPreview({ network, accountName, avatarUrl, text, hashtags, media, reminder, needsMedia, hideReminderNote, className }: Props) {
  const body = text.trim();
  const tags = hashtags.join(" ");
  const empty = !body && !tags && media.length === 0;

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-line bg-[var(--bp-bg-solid)] text-[14px]", className)}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <AccountAvatar network={network} name={accountName} src={avatarUrl} size={34} />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13px] font-semibold">{accountName}</p>
          <p className="text-[12px] text-muted">{reminder ? `${networkName(network)} reminder` : network === "linkedin" ? "Just now" : networkName(network)}</p>
        </div>
      </div>

      {reminder ? (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {!hideReminderNote && (
            <div className="flex items-start gap-2 rounded-xl bg-soft p-3 text-[13px] text-muted">
              <Mail aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>At the scheduled time we email you the text and images below, ready to copy.</span>
            </div>
          )}
          {body && <p className="line-clamp-8 whitespace-pre-wrap break-words">{body}</p>}
          {tags && <p className="break-words font-medium text-pulse-blue">{tags}</p>}
          {media.length > 0 && <Images media={media} ratio="aspect-video" />}
          {empty && <p className="text-muted">Nothing to show yet.</p>}
        </div>
      ) : network === "instagram" ? (
        <>
          {media.length > 0 ? (
            <Images media={media} ratio="aspect-[4/5]" />
          ) : (
            <div className={cn("flex aspect-[4/5] flex-col items-center justify-center gap-2 bg-soft px-6 text-center text-[13px]", needsMedia ? "text-danger" : "text-muted")}>
              <ImagePlus aria-hidden className="size-6" />
              Instagram needs a photo
            </div>
          )}
          <div className="px-3 py-2.5">
            {(body || tags) && (
              <p className="line-clamp-6 whitespace-pre-wrap break-words">
                <span className="font-semibold">{accountName}</span> {body}
                {tags && <span className="block pt-1 font-medium text-pulse-blue">{tags}</span>}
              </p>
            )}
            {empty && <p className="text-muted">Your caption appears here.</p>}
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1.5 px-3 pb-2.5">
            {body && <p className="line-clamp-10 whitespace-pre-wrap break-words">{body}</p>}
            {tags && <p className="break-words font-medium text-pulse-blue">{tags}</p>}
            {empty && <p className="text-muted">Your post appears here.</p>}
          </div>
          <Images media={media} ratio="aspect-[1.91/1]" />
        </>
      )}
    </div>
  );
}
