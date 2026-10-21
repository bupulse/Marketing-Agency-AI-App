import { Badge, type BadgeTone } from "@/components/ui";

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  CHECKING: { label: "Checking", tone: "neutral" },
  TRACKING: { label: "Counting views", tone: "success" },
  INVALID: { label: "Not accepted", tone: "danger" },
  REMOVED: { label: "Removed", tone: "danger" },
  REJECTED: { label: "Rejected", tone: "danger" },
  FINAL: { label: "Final", tone: "blue" },
};

/** A post's status (CreatorPost.status) in the creator's words. */
export function PostStatus({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: "neutral" as BadgeTone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const PAYOUT: Record<string, { label: string; tone: BadgeTone }> = {
  DUE: { label: "To be paid", tone: "violet" },
  PAID: { label: "Paid", tone: "success" },
};

export function PayoutStatus({ status }: { status: string }) {
  const s = PAYOUT[status] ?? { label: status, tone: "neutral" as BadgeTone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
