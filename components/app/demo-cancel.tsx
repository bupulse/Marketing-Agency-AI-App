"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Dialog, useToast } from "@/components/ui";
import { cancelDemoAction } from "@/app/dashboard/demo/actions";

/** "Cancel demo" with a confirm step. The action checks the 2-hour rule again on the server. */
export function DemoCancelButton({ when }: { when: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function confirm() {
    start(async () => {
      const result = await cancelDemoAction();
      setOpen(false);
      if (result.ok) {
        toast("Your demo is cancelled. Book a new time whenever you are ready.", "success");
        router.refresh();
      } else {
        toast(result.error, "error");
      }
    });
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Cancel demo
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Cancel your demo?" description={`Your demo on ${when} will be cancelled. You can book a new time afterwards.`}>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button onClick={confirm} disabled={pending}>
            {pending ? "Cancelling…" : "Cancel demo"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
