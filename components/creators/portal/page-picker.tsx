"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Button, GlassCard } from "@/components/ui";
import { pickPageAction, type PickState } from "@/app/creator/(portal)/actions";

/** Facebook gave several Pages: the creator picks the one they post campaign posts on. */
export function PagePicker({ pages }: { pages: { id: string; name: string }[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<PickState, FormData>(pickPageAction, {});
  useEffect(() => {
    if (state.done) router.replace("/creator/connections?connected=facebook");
  }, [state.done, router]);
  return (
    <GlassCard strong padding="none" className="p-4">
      <form action={action} className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[15px] font-semibold">Which Page do you post on?</legend>
          {pages.map((p, i) => (
            <label key={p.id} className="flex min-h-11 items-center gap-3 rounded-field bg-soft px-3 text-[15px]">
              <input type="radio" name="account" value={p.id} defaultChecked={i === 0} className="size-4" />
              {p.name}
            </label>
          ))}
        </fieldset>
        {state.error && <p role="alert" className="text-sm font-medium text-danger">{state.error}</p>}
        <Button type="submit" disabled={pending} className="self-start">{pending ? "Saving…" : "Connect this Page"}</Button>
      </form>
    </GlassCard>
  );
}
