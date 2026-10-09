"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button, Dialog, Field, Input, Select } from "@/components/ui";

type Action = (formData: FormData) => void | Promise<void>;

/** "Add user": email, name and role. The person gets an email to choose their own password; the admin never sees one. */
export function AddUserDialog({ action, businessId }: { action: Action; businessId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" leading={<UserPlus aria-hidden className="size-4" />} onClick={() => setOpen(true)}>
        Add user
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Add a user" description="They get an email to confirm their address and choose their own password. You never set or see it.">
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="businessId" value={businessId} />
          <Field label="Email address" required>
            <Input name="email" type="email" autoComplete="off" required />
          </Field>
          <Field label="Name (optional)">
            <Input name="name" autoComplete="off" maxLength={100} />
          </Field>
          <Field label="Role">
            <Select name="role" defaultValue="MEMBER">
              <option value="MEMBER">Member</option>
              <option value="ADMIN">Admin</option>
            </Select>
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit">Create user</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** "Change email": the new address is confirmed at once; the old address gets a notice. Optionally mails a reset link to the new one. */
export function ChangeEmailDialog({ action, businessId, userId, email }: { action: Action; businessId: string; userId: string; email: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Change email</Button>
      <Dialog open={open} onOpenChange={setOpen} title="Change sign-in email" description={`Currently ${email}. The old address is told the email was changed by BuPulse support, with the new one partly hidden.`}>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="businessId" value={businessId} />
          <input type="hidden" name="userId" value={userId} />
          <Field label="New email address" required>
            <Input name="newEmail" type="email" autoComplete="off" required />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="sendReset" className="mt-1 size-4" />
            <span>Send a password reset link to the new email</span>
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit">Change email</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
