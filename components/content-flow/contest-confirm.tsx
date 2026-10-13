"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trophy } from "lucide-react";
import { confirmContestAction } from "@/app/dashboard/content/day-actions";
import { Button, Field, GlassCard, Input, useToast } from "@/components/ui";
import { networkLabel } from "@/lib/content-board/labels";

type ContestPost = { id: string; network: string; excerpt: string };

/**
 * Contests the AI suggested (docs/CONTENT.md): each waits here until the owner enters the prize, the end date and how
 * the winner is chosen, and confirms they will give the prize. Then the post can be approved (never on its own).
 */
export function ContestConfirm({ posts, today }: { posts: ContestPost[]; today: string }) {
  if (posts.length === 0) return null;
  return (
    <section aria-labelledby="contests" className="flex flex-col gap-3">
      <h2 id="contests" className="px-1 text-lg font-semibold tracking-[-0.02em]">
        Needs your confirmation: prize & rules
      </h2>
      <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {posts.map((p) => (
          <li key={p.id}>
            <ContestForm post={p} today={today} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ContestForm({ post, today }: { post: ContestPost; today: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [prize, setPrize] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [howChosen, setHowChosen] = useState("");
  const [willPay, setWillPay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <GlassCard className="flex flex-col gap-3 p-4">
      <p className="flex items-center gap-2 text-[14px] font-semibold">
        <Trophy aria-hidden className="size-4 text-pulse-blue" /> {networkLabel(post.network)} contest
      </p>
      <p className="line-clamp-3 text-[14px] text-muted whitespace-pre-line">{post.excerpt}</p>
      <p className="text-[13px] text-muted">BuPulse never sets a prize for you. Fill these in; they replace [PRIZE], [END DATE] and [HOW THE WINNER IS CHOSEN] in the post.</p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const res = await confirmContestAction(post.id, { prize, endsOn, howChosen, willPay });
            if (!res.ok) return setError(res.error);
            toast("Contest confirmed. Approve the post when you are ready.", "success");
            router.refresh();
          });
        }}
      >
        <Field label="Prize" hint="For example: 50,000 RWF, or a free service.">
          <Input value={prize} onChange={(e) => setPrize(e.target.value)} maxLength={120} required />
        </Field>
        <Field label="Ends on">
          <Input type="date" value={endsOn} min={today} onChange={(e) => setEndsOn(e.target.value)} required />
        </Field>
        <Field label="How the winner is chosen" hint="For example: the video with the most likes by Friday 18:00.">
          <Input value={howChosen} onChange={(e) => setHowChosen(e.target.value)} maxLength={200} required />
        </Field>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]">
          <input type="checkbox" checked={willPay} onChange={(e) => setWillPay(e.target.checked)} className="size-5 accent-pulse-blue" required />I will give this prize to the winner.
        </label>
        {error && (
          <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-[14px] text-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending || !willPay}>
          {pending ? "Saving…" : "Confirm prize & rules"}
        </Button>
      </form>
    </GlassCard>
  );
}
