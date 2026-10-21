"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { answerOfferAction, type OfferState } from "@/app/creator/(portal)/actions";

/** Accept or Decline on an invitation from a company (OFFERED). Accepting opens the campaign. */
export function OfferAnswer({ id, campaignId }: { id: string; campaignId: string }) {
  const [state, action, pending] = useActionState<OfferState, FormData>(answerOfferAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="campaignId" value={campaignId} />
      <div className="flex gap-2">
        <Button type="submit" name="answer" value="accept" size="sm" disabled={pending}>
          Accept
        </Button>
        <Button type="submit" name="answer" value="decline" size="sm" variant="outline" disabled={pending}>
          Decline
        </Button>
      </div>
      {state.error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
