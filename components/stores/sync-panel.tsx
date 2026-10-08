"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import { resyncAction } from "@/app/dashboard/stores/actions";

/** "Sync now": re-checks the products already imported. Your own edits are kept. */
export function SyncPanel({ provider, imported, lastSync }: { provider: string; imported: number; lastSync: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          disabled={pending || imported === 0}
          leading={<RefreshCw aria-hidden className={pending ? "size-4 animate-spin" : "size-4"} />}
          onClick={() =>
            start(async () => {
              setMessage(null);
              // One slice per call keeps each request short; keep asking until the server says the pass is done.
              const total = { updated: 0, unchanged: 0, kept: 0, missing: 0, failed: 0, checked: 0 };
              let since: string | undefined;
              for (let i = 0; i < 40; i++) {
                const res = await resyncAction(provider, since);
                if (!res.ok) {
                  setFailed(true);
                  return setMessage(res.error);
                }
                since = res.since;
                const s = res.summary;
                for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += s[k];
                setMessage(`Syncing… ${total.checked} of ${imported} checked`);
                if (s.done) break;
              }
              setFailed(total.failed > 0 && total.failed === total.checked);
              const bits = [`${total.updated} updated`, `${total.unchanged} already up to date`];
              if (total.kept) bits.push(`${total.kept} kept your edits`);
              if (total.missing) bits.push(`${total.missing} no longer in the store`);
              if (total.failed) bits.push(`${total.failed} failed`);
              setMessage(bits.join(", "));
            })
          }
        >
          {pending ? "Syncing…" : "Sync now"}
        </Button>
        <span className="text-[13px] text-muted">{imported} imported · {lastSync}. Synced automatically every day.</span>
      </div>
      {message && (
        <p role="status" className={failed ? "text-[13px] text-danger" : "text-[13px] text-muted"}>
          {message}
        </p>
      )}
    </div>
  );
}
