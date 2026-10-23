import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { DEPARTMENT_KEYS, type AgentMe, type DepartmentKey } from "./contract";
import { agentAccess, agentIdentity, type AgentAccessInput, type AgentNote } from "./app-access";
import { supportBaseFor, supportHref } from "./app-host";

// The support app's page guard (docs/SUPPORT_CHAT.md "Support app and Admin"). The rules live in app-access.ts and are
// the same for the API guard (requireSupportAgent): an agent who is not locked, at AAL2 with an authenticator app.
// Server actions are public POST endpoints, so each one calls requireSupportAgentPage (or requireAgentIdentity) again.

/** "" on support.bupulse.com, "/support" elsewhere (lib/support/app-host.ts). */
export async function supportBase(): Promise<string> {
  return supportBaseFor((await headers()).get("host"));
}

export async function supportUrl(path: string): Promise<string> {
  return supportHref(await supportBase(), path);
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

const agentSelect = { id: true, email: true, name: true, userId: true, status: true, role: true, availability: true, lastSeenAt: true, departments: { select: { department: { select: { key: true } } } } } as const;

/** The agent row for a sign-in: linked to it, else not linked yet and with the same address. A database error finds none. */
export async function agentFor(user: { id: string; email: string | null }) {
  const email = (user.email ?? "").trim().toLowerCase();
  try {
    return await prisma.supportAgent.findFirst({ where: { OR: [{ userId: user.id }, ...(email ? [{ email, userId: null }] : [])] }, select: agentSelect });
  } catch {
    return null;
  }
}

type AgentRow = NonNullable<Awaited<ReturnType<typeof agentFor>>>;

export function agentMe(agent: AgentRow): AgentMe {
  const keys = agent.departments.map((d) => d.department.key).filter((k): k is DepartmentKey => (DEPARTMENT_KEYS as readonly string[]).includes(k));
  const availability = agent.availability === "online" || agent.availability === "away" ? agent.availability : "offline";
  return { id: agent.id, name: agent.name, email: agent.email, role: agent.role, availability, departments: keys };
}

async function accessInput(supabase: Supabase): Promise<{ input: AgentAccessInput; agent: AgentRow | null }> {
  const { data, error } = await supabase.auth.getUser();
  const user = !error && data?.user ? data.user : null;
  if (!user) return { input: { user: null, agent: null, methods: null, aal: null, hasVerifiedTotp: false }, agent: null };
  const [agent, aal, factors] = await Promise.all([agentFor({ id: user.id, email: user.email ?? null }), supabase.auth.mfa.getAuthenticatorAssuranceLevel(), supabase.auth.mfa.listFactors()]);
  return {
    agent,
    input: {
      user: { id: user.id, email: user.email ?? null, emailConfirmed: !!user.email_confirmed_at },
      agent,
      methods: aal.data?.currentAuthenticationMethods ?? null,
      aal: aal.data ? { currentLevel: aal.data.currentLevel, nextLevel: aal.data.nextLevel } : null,
      hasVerifiedTotp: !!factors.data?.totp?.some((f) => f.status === "verified"),
    },
  };
}

const signInPath = (note?: AgentNote) => (note && note !== "signed_out" ? `/sign-in?error=${note}` : "/sign-in");

type Identity = { supabase: Supabase; agent: AgentRow; userId: string; hasVerifiedTotp: boolean; aal: AgentAccessInput["aal"]; methods: unknown };

/** The signed-in agent before the authenticator step, or why not (signed out, not an agent, locked). */
export async function currentAgentIdentity(): Promise<{ ok: true; identity: Identity } | { ok: false; note: AgentNote }> {
  const supabase = await createClient();
  const { input, agent } = await accessInput(supabase);
  const who = agentIdentity(input);
  if (!who.ok || !agent || !input.user) return { ok: false, note: who.ok ? "no_access" : who.note };
  return { ok: true, identity: { supabase, agent, userId: input.user.id, hasVerifiedTotp: input.hasVerifiedTotp, aal: input.aal, methods: input.methods } };
}

/**
 * The signed-in agent before the authenticator step (the code, setup, invite and new-password pages). Signed out, not
 * an agent, or locked → the sign-in page with a note.
 */
export async function requireAgentIdentity(): Promise<Identity> {
  const who = await currentAgentIdentity();
  if (!who.ok) redirect(await supportUrl(signInPath(who.note)));
  return who.identity;
}

/**
 * Gate for every support app page and server action: an active (or first-time invited) agent, not locked, at AAL2
 * with an authenticator app. The first full sign-in links the sign-in to the row and marks it active; later sign-ins
 * note the time at most hourly (Admin -> Live chat shows it).
 */
export const requireSupportAgentPage = cache(async (): Promise<AgentMe> => {
  const supabase = await createClient();
  const { input, agent } = await accessInput(supabase);
  const access = agentAccess(input);
  if (!access.ok || !agent || !input.user) {
    const to = access.ok ? signInPath("no_access") : access.to === "sign-in" ? signInPath(access.note) : `/${access.to}`;
    redirect(await supportUrl(to));
  }
  const stale = !agent.lastSeenAt || Date.now() - agent.lastSeenAt.getTime() > 3_600_000;
  if (access.activate || stale) {
    await prisma.supportAgent
      .updateMany({ where: { id: agent.id, status: { not: "locked" } }, data: { userId: input.user.id, status: "active", lastSeenAt: new Date() } })
      .catch(() => undefined);
  }
  return agentMe(agent);
});
