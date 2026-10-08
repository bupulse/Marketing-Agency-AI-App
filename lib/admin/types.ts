// Shared types for the admin service (no server imports: safe to import anywhere).

/** Who is acting. `viaApi` is true for the Jarvis REST API and MCP server, false for the admin console. */
export type AdminContext = {
  /** "admin" (the console) or "jarvis:<AdminApiKey id>". Written to AuditLog.actor. */
  actor: string;
  ip?: string | null;
  viaApi: boolean;
};

export const consoleContext = (ip?: string | null): AdminContext => ({ actor: "admin", ip: ip ?? null, viaApi: false });
export const apiContext = (keyId: string, ip?: string | null): AdminContext => ({ actor: `jarvis:${keyId}`, ip: ip ?? null, viaApi: true });

export type AdminErrorCode =
  | "invalid"
  | "not_found"
  | "conflict"
  | "confirm_required"
  | "idempotency_required"
  | "forbidden"
  | "unavailable";

const STATUS: Record<AdminErrorCode, number> = {
  invalid: 400,
  not_found: 404,
  conflict: 409,
  confirm_required: 400,
  idempotency_required: 400,
  forbidden: 403,
  unavailable: 503,
};

export class AdminError extends Error {
  status: number;
  constructor(
    public code: AdminErrorCode,
    message: string,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export type Page<T> = { items: T[]; nextCursor: string | null };

export type ApprovalKind = "issue_refund" | "change_plan";
/** needs_check: the provider may or may not have done it. Never retried automatically; verify in Paddle first. */
export type ApprovalStatus = "pending" | "approved" | "rejected" | "executed" | "failed" | "needs_check";
export const APPROVAL_STATUSES: ApprovalStatus[] = ["pending", "approved", "rejected", "executed", "failed", "needs_check"];

export type ApprovalView = {
  id: string;
  kind: ApprovalKind;
  params: Record<string, unknown>;
  status: ApprovalStatus;
  requestedBy: string;
  idempotencyKey: string;
  result: unknown;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
};

/** What a money request returns: the approval's id and status. `replayed` is true when the idempotency key was seen before. */
export type ApprovalReceipt = { id: string; status: ApprovalStatus; kind: ApprovalKind; replayed: boolean; message: string };

export const ANNOUNCEMENT_AUDIENCES = ["all", "plan"] as const;
