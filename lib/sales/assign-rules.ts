// The rules of a reassignment that the form shows too (no server imports). The change itself: ./assign.ts.
import { AdminError } from "@/lib/admin/types";

export const REASON_MIN = 3;
export const REASON_MAX = 200;

/** The reason, trimmed and on one line; 3 to 200 characters or an error. */
export function cleanReason(value: string | null | undefined): string {
  const r = (value ?? "").trim().replace(/\s+/g, " ");
  if (r.length < REASON_MIN || r.length > REASON_MAX) throw new AdminError("invalid", `Write a reason of ${REASON_MIN} to ${REASON_MAX} characters.`);
  return r;
}
