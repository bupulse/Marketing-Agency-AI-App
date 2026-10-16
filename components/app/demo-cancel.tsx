"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Dialog, useToast } from "@/components/ui";
import { cancelDemoAction } from "@/app/dashboard/demo/actions";
import { cancelPlanCallAction } from "@/app/custom-plan/call/actions";

const TEXT = {
  demo: { button: "Cancel demo", title: "Cancel your demo?", body: (when: string) => `Your demo on ${when} will be cancelled. You can book a new time afterwards.`, done: "Your demo is cancelled. Book a new time whenever you are ready." },
  call: { button: "Cancel call", title: "Cancel your call?", body: (when: string) => `Your call on ${when} will be cancelled. We still answer your request by email, and you can book a new time afterwards.`, done: "Your call is cancelled. We still answer your request by email." },
};

/** "Cancel demo" (or the custom plan call) with a confirm step. The action checks the 2-hour rule again on the server. */
export function DemoCancelButton({ when, kind = "demo" }: { when: string; kind?: "demo" | "call" }) {
  const text = TEXT[kind];
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function confirm() {
    start(async () => {
      const result = await (kind === "call" ? cancelPlanCallAction() : cancelDemoAction());
      setOpen(false);
      if (result.ok) {
        toast(text.done, "success");
        router.refresh();
      } else {
        toast(result.error, "error");
      }
    });
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {text.button}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={text.title} description={text.body(when)}>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button onClick={confirm} disabled={pending}>
            {pending ? "Cancelling…" : text.button}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
