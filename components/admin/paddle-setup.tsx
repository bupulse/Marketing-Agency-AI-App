"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog } from "@/components/ui";
import { paddleSetUpStepAction } from "@/app/admin/(console)/settings/actions";

const STEPS = [
  { step: "plans", label: "Plans" },
  { step: "regions", label: "Regional card prices" },
  { step: "webhook", label: "Webhook" },
] as const;

/**
 * "Set up prices": runs the set-up one short step per request (plans two at a time, regional prices four at a time, then
 * the webhook), so no request outlives the hosting time limit, and shows where it is. Each step is audited on the server.
 */
export function PaddleSetUp({ description }: { description: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);

  async function run() {
    setAsking(false);
    setRunning(true);
    setLog([]);
    setProblems([]);
    for (const { step, label } of STEPS) {
      let attempted: string[] = [];
      const done: string[] = [];
      for (let round = 0; round < 50; round++) {
        setLog((l) => [...l.filter((x) => !x.startsWith(`${label}:`)), `${label}: working…`]);
        const r = await paddleSetUpStepAction(step, attempted).catch(() => ({ ok: false as const, error: "The request failed. Check your connection and run it again (it carries on where it stopped)." }));
        if (!r.ok) {
          setProblems((p) => [...p, `${label}: ${r.error}`]);
          setLog((l) => [...l.filter((x) => !x.startsWith(`${label}:`)), `${label}: stopped`]);
          setRunning(false);
          router.refresh();
          return;
        }
        attempted = r.result.attempted;
        done.push(...r.result.done);
        if (r.result.problems.length) setProblems((p) => [...p, ...r.result.problems]);
        if (!r.result.more) break;
      }
      setLog((l) => [...l.filter((x) => !x.startsWith(`${label}:`)), `${label}: ${done.length ? done.join(", ") : "nothing missing"}`]);
    }
    setRunning(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button size="sm" onClick={() => setAsking(true)} disabled={running}>
          {running ? "Setting up…" : "Set up prices"}
        </Button>
      </div>
      <Dialog open={asking} onOpenChange={setAsking} title="Set up Paddle prices and the webhook?" description={description}>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => setAsking(false)}>
            Not now
          </Button>
          <Button onClick={() => void run()}>Set up prices</Button>
        </div>
      </Dialog>
      {log.length > 0 && (
        <ul role="status" className="flex flex-col gap-0.5 text-[13px] text-muted">
          {log.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {problems.length > 0 && (
        <ul role="alert" className="flex flex-col gap-0.5 rounded-xl bg-danger-bg px-3 py-2 text-[13px] font-medium text-danger">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
