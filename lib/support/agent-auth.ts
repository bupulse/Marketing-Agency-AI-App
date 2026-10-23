import "server-only";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/db";
import type { AgentMe, DepartmentKey } from "./contract";
import { SupportError, limit } from "./http";
import { SUPPORT_LIMITS } from "./limits";

// The support app's sign-in check (docs/SUPPORT_CHAT.md section 3) for every /agent route: a Supabase access token as
// Authorization: Bearer, verified with Supabase Auth (a revoked session fails), at aal2 (email + password + the
// authenticator code), for an active, unlocked SupportAgent. Agents are never admin accounts; the admin console's own
// check is separate (lib/admin/auth.ts). An invited agent's first full sign-in links the account and activates them.

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

export type VerifiedToken = { userId: string; email: string | null; emailConfirmed: boolean; aal: string | null };

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
  return { userId: data.user.id, email: data.user.email?.toLowerCase() ?? null, emailConfirmed: !!data.user.email_confirmed_at, aal: typeof claims?.aal === "string" ? claims.aal : null };
}

const agentSelect = { id: true, userId: true, name: true, email: true, role: true, status: true, availability: true, maxChats: true, lockedAt: true, lastSeenAt: true, departments: { select: { department: { select: { id: true, key: true } } } } } as const;

export async function requireSupportAgent(request: Request, verify: (token: string) => Promise<VerifiedToken | null> = verifyAccessToken): Promise<AgentSession> {
  const match = /^Bearer\s+(\S{20,4096})$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) throw new SupportError(401, "unauthorized", "Sign in to the support app again.", { "www-authenticate": "Bearer" });
  const token = await verify(match[1]).catch(() => null);
  if (!token) throw new SupportError(401, "unauthorized", "Your sign-in has ended. Sign in again.", { "www-authenticate": "Bearer" });
  if (token.aal !== "aal2") throw new SupportError(403, "mfa_required", "Enter the 6-digit code from your authenticator app first.");

  let agent = await prisma.supportAgent.findUnique({ where: { userId: token.userId }, select: agentSelect });
  if (!agent && token.email && token.emailConfirmed) {
    // First full sign-in after the invitation: link this account to the invited agent with the same address.
    const invited = await prisma.supportAgent.findUnique({ where: { email: token.email }, select: { id: true, userId: true, status: true } });
    if (invited && !invited.userId && invited.status === "invited") {
      await prisma.supportAgent.updateMany({ where: { id: invited.id, userId: null, status: "invited" }, data: { userId: token.userId, status: "active" } });
      agent = await prisma.supportAgent.findUnique({ where: { userId: token.userId }, select: agentSelect });
    }
  }
  if (!agent) throw new SupportError(403, "not_agent", "This account is not a support agent. Ask the owner to invite you in Admin, Live chat.");
  if (agent.status === "locked" || agent.lockedAt) throw new SupportError(403, "locked", "Your support account is locked. Ask the owner.");
  if (agent.status !== "active") throw new SupportError(403, "not_active", "Your support account is not active yet. Open the invitation email first.");
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
