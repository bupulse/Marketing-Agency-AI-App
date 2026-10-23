// Who may use the support app (docs/SUPPORT_CHAT.md "Support app and Admin"). Pure rules, shared by the page guard
// (lib/support/app-auth.ts) and the API guard (requireSupportAgent, sc-core), so a page and an API call never disagree.
// Agents are SupportAgent rows with their own sign-in: never the owner's, a staff member's or a client's.

export type AgentStatus = "invited" | "active" | "locked";

/** The parts of a SupportAgent row the rules read. */
export type AgentAccessRow = { id: string; email: string; userId: string | null; status: string };

export type AgentAccessInput = {
  user: { id: string; email: string | null; emailConfirmed: boolean } | null;
  agent: AgentAccessRow | null;
  /** How this session signed in (Supabase's authentication methods). */
  methods: unknown;
  aal: { currentLevel: string | null; nextLevel: string | null } | null;
  /** The user has a verified authenticator-app (TOTP) factor. */
  hasVerifiedTotp: boolean;
};

export type AgentNote = "no_access" | "locked" | "signed_out";

export type AgentAccess =
  | { ok: true; agent: AgentAccessRow; /** First full sign-in: link the sign-in to the row and mark it active. */ activate: boolean }
  | { ok: false; to: "sign-in"; note?: AgentNote }
  | { ok: false; to: "verify" | "setup" };

/** Sign-in methods that prove the person knows the password or holds the mailbox. Google and other providers do not count. */
const FIRST_STEP = ["password", "otp", "email", "magiclink", "invite", "recovery"];

export function signedInAsAgent(methods: unknown): boolean {
  return Array.isArray(methods) && methods.some((m) => FIRST_STEP.includes((m as { method?: string } | null)?.method ?? ""));
}

/**
 * The first step only: a signed-in, confirmed address that is a SupportAgent which is not locked (and, once linked,
 * linked to this very sign-in). The sign-in, invite and authenticator pages use this; everything else uses agentAccess.
 */
export function agentIdentity(input: Pick<AgentAccessInput, "user" | "agent" | "methods">): { ok: true; agent: AgentAccessRow } | { ok: false; note: AgentNote } {
  const { user, agent } = input;
  if (!user) return { ok: false, note: "signed_out" };
  if (!user.emailConfirmed || !user.email || !agent) return { ok: false, note: "no_access" };
  if (agent.email !== user.email.trim().toLowerCase()) return { ok: false, note: "no_access" };
  // A row linked to another sign-in (the address was re-created by someone else) is not let in.
  if (agent.userId && agent.userId !== user.id) return { ok: false, note: "no_access" };
  if (agent.status === "locked") return { ok: false, note: "locked" };
  if (agent.status !== "active" && agent.status !== "invited") return { ok: false, note: "no_access" };
  if (!signedInAsAgent(input.methods)) return { ok: false, note: "no_access" };
  return { ok: true, agent };
}

/**
 * The whole gate for every support app page and agent API call: an agent who is not locked, at AAL2 with a verified
 * authenticator app. Below AAL2 they are sent to enter the code, or to add an app first.
 */
export function agentAccess(input: AgentAccessInput): AgentAccess {
  const who = agentIdentity(input);
  if (!who.ok) return { ok: false, to: "sign-in", note: who.note === "signed_out" ? undefined : who.note };
  if (input.aal?.currentLevel !== "aal2") return { ok: false, to: input.aal?.nextLevel === "aal2" ? "verify" : "setup" };
  // AAL2 can only come from a verified factor; check it is an authenticator app rather than assuming.
  if (!input.hasVerifiedTotp) return { ok: false, to: "setup" };
  return { ok: true, agent: who.agent, activate: who.agent.status === "invited" || !who.agent.userId };
}

export const MAILBOX_PROOF_MS = 10 * 60 * 1000;
const MAILBOX = ["otp", "email", "magiclink", "invite", "recovery", "email/signup"];

/**
 * True when this session opened an emailed link or code in the last 10 minutes (the invite, a new-password link, or
 * an emailed code). Adding an authenticator and choosing a password need it, so a password alone cannot add one.
 */
export function hasRecentMailboxProof(methods: unknown, now = Date.now()): boolean {
  if (!Array.isArray(methods)) return false;
  return methods.some((m) => {
    const { method, timestamp } = (m ?? {}) as { method?: string; timestamp?: number };
    return MAILBOX.includes(method ?? "") && typeof timestamp === "number" && now - timestamp * 1000 < MAILBOX_PROOF_MS;
  });
}
