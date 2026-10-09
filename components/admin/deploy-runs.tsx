"use client";

import { useRouter } from "next/navigation";
import { ExternalLink, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Empty, TableWrap, Td, Th } from "@/components/admin/ui";
import { Badge, type BadgeTone } from "@/components/ui";
import { dateTime } from "@/lib/admin/format";
import type { WorkflowRun } from "@/lib/admin/github";

const POLL_MS = 10_000;

type Page = { runs: WorkflowRun[]; inFlight: WorkflowRun | null };

/** One word and a colour for a run. */
export function runLabel(run: Pick<WorkflowRun, "status" | "conclusion">): { label: string; tone: BadgeTone; busy: boolean } {
  if (run.status === "completed") {
    switch (run.conclusion) {
      case "success":
        return { label: "Deployed", tone: "success", busy: false };
      case "failure":
      case "timed_out":
      case "startup_failure":
        return { label: "Failed", tone: "danger", busy: false };
      case "cancelled":
        return { label: "Cancelled", tone: "neutral", busy: false };
      case "skipped":
        return { label: "Skipped", tone: "neutral", busy: false };
      default:
        return { label: run.conclusion ?? "Finished", tone: "neutral", busy: false };
    }
  }
  if (run.status === "in_progress") return { label: "Running", tone: "blue", busy: true };
  if (run.status === "waiting") return { label: "Waiting for approval", tone: "violet", busy: true };
  if (run.status === "queued" || run.status === "requested" || run.status === "pending") return { label: "Queued", tone: "violet", busy: true };
  return { label: run.status, tone: "neutral", busy: false };
}

const short = (sha: string) => sha.slice(0, 7);
const minutes = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000));

/**
 * The deploy workflow's last runs. While one is queued or running it asks /admin/settings/updates/runs every
 * 10 seconds; when the run finishes it refreshes the page so the version and buttons are current.
 */
export function DeployRuns({ initial }: { initial: Page }) {
  const router = useRouter();
  const [page, setPage] = useState(initial);
  const [error, setError] = useState(false);
  // New server data (after router.refresh()) replaces what polling collected.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setPage(initial);
  }

  useEffect(() => {
    if (!page.inFlight) return;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/admin/settings/updates/runs", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as Page;
        if (stopped) return;
        setError(false);
        setPage(next);
        // The run finished: re-render the page so the version, badge and buttons are current.
        if (!next.inFlight) router.refresh();
      } catch {
        if (!stopped) setError(true);
      }
    };
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [page.inFlight, router]);

  if (page.runs.length === 0) return <Empty>No deploys yet. The first push to main, or the first Install update, will show here.</Empty>;

  return (
    <div className="flex flex-col gap-3">
      {page.inFlight && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          A deploy is {page.inFlight.status === "in_progress" ? "running" : page.inFlight.status === "waiting" ? "waiting for approval on GitHub" : "queued"}; this list refreshes every 10 seconds.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-danger">Could not refresh the list from GitHub; it will try again.</p>}
      <TableWrap caption="Last deploy runs">
        <thead>
          <tr>
            <Th>Status</Th>
            <Th>What</Th>
            <Th>Started</Th>
            <Th>Finished</Th>
            <Th>Run</Th>
          </tr>
        </thead>
        <tbody>
          {page.runs.map((run) => {
            const l = runLabel(run);
            const finished = run.status === "completed";
            return (
              <tr key={run.id}>
                <Td>
                  <Badge tone={l.tone}>{l.label}</Badge>
                </Td>
                <Td>
                  <span className="block max-w-[22rem] truncate">{run.title}</span>
                  <span className="block text-xs text-muted">
                    {run.event === "workflow_dispatch" ? "Started from the console" : run.event === "push" ? "Push to main" : run.event}
                    {run.branch ? ` · ${run.branch}` : ""} · <code className="font-mono">{short(run.sha)}</code>
                    {run.actor ? ` · ${run.actor}` : ""}
                  </span>
                </Td>
                <Td>{dateTime(run.startedAt ?? run.createdAt)}</Td>
                <Td>{finished ? `${dateTime(run.updatedAt)} (${minutes(run.startedAt ?? run.createdAt, run.updatedAt)} min)` : "—"}</Td>
                <Td>
                  <a href={run.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline">
                    #{run.id} <ExternalLink aria-hidden className="size-3.5" />
                    <span className="sr-only">(opens GitHub in a new tab)</span>
                  </a>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
    </div>
  );
}
