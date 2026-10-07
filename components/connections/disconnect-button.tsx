"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Dialog } from "@/components/ui";
import { disconnectAction } from "@/app/dashboard/connections/actions";

function Confirm() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} className="!bg-danger !bg-none !text-white !shadow-none">
      {pending ? "Disconnecting..." : "Disconnect"}
    </Button>
  );
}

/** Disconnect with a confirmation, so one stray tap cannot cut an account off. */
export function DisconnectButton({ id, name, reminder }: { id: string; name: string; reminder: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} aria-label={`Disconnect ${name}`}>
        Disconnect
      </Button>
      {open && (
        <Dialog open onOpenChange={setOpen} title={`Disconnect ${name}?`} description={reminder ? "BuPulse will stop sending reminders for this account." : "BuPulse will stop posting to this account and forget its access."}>
          <p className="text-[15px] text-muted">
            Posts you scheduled for it go back to drafts, so nothing is lost. You can connect it again any time.
          </p>
          <form action={disconnectAction} onSubmit={() => setTimeout(() => setOpen(false), 400)} className="mt-6 flex flex-wrap justify-end gap-3">
            <input type="hidden" name="id" value={id} />
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Confirm />
          </form>
        </Dialog>
      )}
    </>
  );
}
