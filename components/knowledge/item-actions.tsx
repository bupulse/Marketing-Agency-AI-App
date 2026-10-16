"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Copy, PenLine, Trash2 } from "lucide-react";
import { Button, Dialog, useToast } from "@/components/ui";
import { changeProductStatus, deleteProduct, duplicateProduct } from "@/app/dashboard/knowledge/products/actions";
import { changeCampaignStatus, deleteCampaign } from "@/app/dashboard/knowledge/campaigns/actions";

/** Edit, duplicate (products), archive or restore, and delete, for a product's or campaign's page. */
export function ItemActions({ kind, id, name, archived }: { kind: "product" | "campaign"; id: string; name: string; archived: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const base = kind === "product" ? "/dashboard/knowledge/products" : "/dashboard/knowledge/campaigns";
  const noun = kind === "product" ? "product" : "campaign";

  function run(task: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string, after?: () => void) {
    start(async () => {
      const result = await task();
      if (!result.ok) return toast(result.error, "error");
      toast(done, "success");
      if (after) after();
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="ghost" size="sm" href={`${base}/${id}/edit`} leading={<PenLine aria-hidden className="size-4" />}>
        Edit
      </Button>
      {kind === "product" && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          leading={<Copy aria-hidden className="size-4" />}
          onClick={() =>
            start(async () => {
              const result = await duplicateProduct(id);
              if (!result.ok) return toast(result.error, "error");
              toast("Copied as a draft.", "success");
              router.push(`${base}/${result.productId}/edit`);
            })
          }
        >
          Duplicate
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        leading={archived ? <ArchiveRestore aria-hidden className="size-4" /> : <Archive aria-hidden className="size-4" />}
        onClick={() =>
          run(
            () => (kind === "product" ? changeProductStatus(id, archived ? "ACTIVE" : "ARCHIVED") : changeCampaignStatus(id, archived ? "ACTIVE" : "ARCHIVED")),
            archived ? "Restored." : "Archived. It is kept, with its content, but left out of Autopilot and your chat assistant.",
          )
        }
      >
        {archived ? "Restore" : "Archive"}
      </Button>
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)} leading={<Trash2 aria-hidden className="size-4" />}>
        Delete
      </Button>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete this ${noun}?`}
        description={`"${name}" and all its written content will be removed. Its photos stay in your gallery. This cannot be undone. Archive it instead to keep it out of the way.`}
      >
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
            Keep it
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              run(
                () => (kind === "product" ? deleteProduct(id) : deleteCampaign(id)),
                `${kind === "product" ? "Product" : "Campaign"} deleted.`,
                () => router.push(base),
              )
            }
          >
            {pending ? "Deleting…" : `Delete ${noun}`}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
