import "server-only";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/db";
import type { AgentMe, DepartmentKey } from "./contract";
import { agentAccess } from "./app-access";
import { SupportError, limit } from "./http";
import { SUPPORT_LIMITS } from "./limits";

// The support API's sign-in check (docs/SUPPORT_CHAT.md section 3) for every /agent route: a Supabase access token as
// Authorization: Bearer, verified with Supabase Auth (a revoked session fails), then the support app's own rules
// (app-access.ts, shared with its pages): a SupportAgent that is not locked, at aal2 with an authenticator app. Agents
// are never admin accounts; the admin console's check is separate (lib/admin/auth.ts).

export type AgentSession = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: "AGENT" | "SUPERVISOR";
  availability: "online" | "away" | "offline";
  maxChats: number;
  departments: { id: string; key: DepartmentKey }[];
};

export type VerifiedToken = {
  userId: string;
  email: string | null;
  emailConfirmed: boolean;
  /** The token's aal claim, and what the account could reach (aal2 once it has a verified authenticator). */
  aal: { currentLevel: string | null; nextLevel: string | null };
  /** How the session signed in: the token's amr claim ([{ method, timestamp }]). */
  methods: unknown;
  hasVerifiedTotp: boolean;
};

/** Claims of a JWT the Auth server has just accepted. Not a signature check on its own. */
export function jwtClaims(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Asks Supabase Auth whether the token is valid now (signature, expiry, session not revoked). */
export async function verifyAccessToken(token: string): Promise<VerifiedToken | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  const claims = jwtClaims(token);
  const hasVerifiedTotp = !!data.user.factors?.some((f) => f.factor_type === "totp" && f.status === "verified");
  return {
    userId: data.user.id,
    email: data.user.email?.toLowerCase() ?? null,
    emailConfirmed: !!data.user.email_confirmed_at,
    aal: { currentLevel: typeof claims?.aal === "string" ? claims.aal : null, nextLevel: hasVerifiedTotp ? "aal2" : "aal1" },
    methods: claims?.amr ?? null,
    hasVerifiedTotp,
  };
}

const agentSelect = { id: true, userId: true, name: true, email: true, role: true, status: true, availability: true, maxChats: true, lockedAt: true, lastSeenAt: true, departments: { select: { department: { select: { id: true, key: true } } } } } as const;

const REFUSED: Record<string, { status: number; code: string; message: string }> = {
  "sign-in": { status: 401, code: "unauthorized", message: "Sign in to the support app again." },
  locked: { status: 403, code: "locked", message: "Your support account is locked. Ask the owner." },
  no_access: { status: 403, code: "not_agent", message: "This account is not a support agent. Ask the owner to invite you in Admin, Live chat." },
  verify: { status: 403, code: "mfa_required", message: "Enter the 6-digit code from your authenticator app first." },
  setup: { status: 403, code: "mfa_required", message: "Add an authenticator app to your support account first." },
};

/**
 * The same rules as the support app's pages (lib/support/app-access.ts agentAccess): an agent who is not locked, at
 * aal2 with a verified authenticator app, linked to this sign-in (an invited agent is linked and activated here).
 */
export async function requireSupportAgent(request: Request, verify: (token: string) => Promise<VerifiedToken | null> = verifyAccessToken): Promise<AgentSession> {
  const match = /^Bearer\s+(\S{20,4096})$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) throw new SupportError(401, "unauthorized", "Sign in to the support app again.", { "www-authenticate": "Bearer" });
  const token = await verify(match[1]).catch(() => null);
  if (!token) throw new SupportError(401, "unauthorized", "Your sign-in has ended. Sign in again.", { "www-authenticate": "Bearer" });
  if (token.aal.currentLevel !== "aal2") throw new SupportError(403, "mfa_required", REFUSED.verify.message);

  // The row for this sign-in: linked to it, else not linked yet and with the same address (app-auth.ts agentFor).
  const found = await prisma.supportAgent.findFirst({ where: { OR: [{ userId: token.userId }, ...(token.email ? [{ email: token.email, userId: null }] : [])] }, select: agentSelect });
  const access = agentAccess({
    user: { id: token.userId, email: token.email, emailConfirmed: token.emailConfirmed },
    agent: found ? { id: found.id, email: found.email, userId: found.userId, status: found.lockedAt ? "locked" : found.status } : null,
    methods: token.methods,
    aal: token.aal,
    hasVerifiedTotp: token.hasVerifiedTotp,
  });
  if (!access.ok) {
    const refused = REFUSED[access.to === "sign-in" ? (access.note ?? "sign-in") : access.to];
    throw new SupportError(refused.status, refused.code, refused.message);
  }
  let agent = found!;
  if (access.activate) {
    // First full sign-in after the invitation: link this sign-in and mark the agent active.
    await prisma.supportAgent.updateMany({ where: { id: agent.id, status: { not: "locked" }, OR: [{ userId: null }, { userId: token.userId }] }, data: { userId: token.userId, status: "active" } });
    agent = (await prisma.supportAgent.findUnique({ where: { id: agent.id }, select: agentSelect })) ?? agent;
    if (agent.userId !== token.userId || agent.status !== "active") throw new SupportError(403, "not_agent", REFUSED.no_access.message);
  }
  await limit(`support:agent:${agent.id}`, SUPPORT_LIMITS.agent);
  if (!agent.lastSeenAt || Date.now() - agent.lastSeenAt.getTime() > 60_000) {
    await prisma.supportAgent.update({ where: { id: agent.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return {
    id: agent.id,
    userId: token.userId,
    name: agent.name,
    email: agent.email,
    role: agent.role,
    availability: (["online", "away", "offline"].includes(agent.availability) ? agent.availability : "offline") as AgentSession["availability"],
    maxChats: agent.maxChats,
    departments: agent.departments.map((d) => ({ id: d.department.id, key: d.department.key as DepartmentKey })),
  };
}

export function agentMe(a: AgentSession): AgentMe {
  return { id: a.id, name: a.name, email: a.email, role: a.role, availability: a.availability, departments: a.departments.map((d) => d.key) };
}

export function requireSupervisor(a: AgentSession) {
  if (a.role !== "SUPERVISOR") throw new SupportError(403, "supervisor_only", "Only supervisors can do this.");
}
