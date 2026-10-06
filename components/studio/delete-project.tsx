"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button, Dialog, useToast } from "@/components/ui";
import { deleteProject } from "@/app/dashboard/projects/actions";

export function DeleteProjectButton({ projectId, title }: { projectId: string; title: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function confirm() {
    start(async () => {
      const result = await deleteProject(projectId);
      if (result.ok) {
        toast("Project deleted.", "success");
        router.push("/dashboard/projects");
        return;
      }
      toast(result.error, "error");
      setOpen(false);
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} leading={<Trash2 aria-hidden className="size-4" />}>
        Delete
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Delete this project?" description={`"${title}" and all its written content will be removed. This cannot be undone.`}>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Keep it
          </Button>
          <Button onClick={confirm} disabled={pending}>
            {pending ? "Deleting…" : "Delete project"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
