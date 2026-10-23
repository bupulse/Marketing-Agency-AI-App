"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { emailSchema, passwordSchema } from "@/lib/auth/schemas";
import { padTo, publicLimited } from "@/lib/request-limits";
import { rateLimit, RateLimitError } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { sendAgentPasswordReset } from "@/lib/support/agents";
import { agentIdentity, hasRecentMailboxProof } from "@/lib/support/app-access";
import { agentFor, requireAgentIdentity, supportUrl } from "@/lib/support/app-auth";

// The support app's sign-in (docs/SUPPORT_CHAT.md "Support app and Admin"): email + password, then the 6-digit code
// from an authenticator app. The invite link and "Forgot password" both lead to choosing a password. Every answer to a
// stranger is the same as to an agent, so the pages never tell who works in support.

export type SignInState = { error?: string };
export type CodeState = { error?: string };
export type EnrollState = { error?: string; needEmail?: boolean; factorId?: string; qr?: string; secret?: string };
export type PasswordFlowState = { step?: "start" | "code" | "password"; error?: string };
export type ForgotState = { error?: string; sent?: boolean };

const ANSWER_MS = 1200;
const CODE_RULE = { limit: 8, windowSeconds: 10 * 60 };
const ENROLL_SEND_RULE = { limit: 3, windowSeconds: 10 * 60 };
const tooMany = "Too many attempts. Wait a few minutes and try again.";
const wrongPassword = "That email and password do not open the support app.";

export async function signInAgent(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const started = Date.now();
  const result = await signInNow(formData);
  await padTo(started, ANSWER_MS);
  return result;
}

async function signInNow(formData: FormData): Promise<SignInState> {
  const parsed = emailSchema.safeParse(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  if (!parsed.success || !password) return { error: "Enter your work email and password." };
  const email = parsed.data;
  const limited = await publicLimited("login", email);
  if (limited) return { error: limited };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: wrongPassword };
  const agent = await agentFor({ id: data.user.id, email: data.user.email ?? null });
  const who = agentIdentity({ user: { id: data.user.id, email: data.user.email ?? null, emailConfirmed: !!data.user.email_confirmed_at }, agent, methods: [{ method: "password" }] });
  if (!who.ok) {
    await supabase.auth.signOut();
    return { error: who.note === "locked" ? "Your account is locked. Ask your supervisor to unlock it." : wrongPassword };
  }
  const { data: factors } = await supabase.auth.mfa.listFactors();
  redirect(await supportUrl(factors?.totp?.some((f) => f.status === "verified") ? "/verify" : "/setup"));
}

const codeSchema = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app.");

async function checkCode(agentId: string, raw: FormDataEntryValue | null): Promise<string | { error: string }> {
  const parsed = codeSchema.safeParse(String(raw ?? ""));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await rateLimit(`support-verify:${agentId}`, CODE_RULE);
  } catch (e) {
    if (e instanceof RateLimitError) return { error: tooMany };
    throw e;
  }
  return parsed.data;
}

/** Step 2 of 2: the authenticator code. */
export async function verifyAgentCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const { agent, supabase } = await requireAgentIdentity();
  const code = await checkCode(agent.id, formData.get("code"));
  if (typeof code !== "string") return code;
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.find((f) => f.status === "verified");
  if (!factor) redirect(await supportUrl("/setup"));
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return { error: "That code did not match. Try the next code from your app." };
  redirect(await supportUrl("/"));
}

/** Adding an authenticator without a fresh invite or reset link: first an emailed code, so a password alone cannot add one. */
export async function sendAgentEnrollCode(): Promise<CodeState> {
  const { agent, supabase } = await requireAgentIdentity();
  try {
    await rateLimit(`support-enroll-send:${agent.id}`, ENROLL_SEND_RULE);
  } catch (e) {
    if (e instanceof RateLimitError) return { error: tooMany };
    throw e;
  }
  const { error } = await supabase.auth.signInWithOtp({ email: agent.email, options: { shouldCreateUser: false } });
  if (error) return { error: "Could not send the code. Please try again in a minute." };
  return {};
}

export async function confirmAgentEnrollCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const { agent, userId, supabase } = await requireAgentIdentity();
  const token = String(formData.get("code") ?? "").trim();
  if (!/^\d{6,10}$/.test(token)) return { error: "Enter the code from the email." };
  try {
    await rateLimit(`support-enroll-try:${agent.id}`, CODE_RULE);
  } catch (e) {
    if (e instanceof RateLimitError) return { error: tooMany };
    throw e;
  }
  const { data, error } = await supabase.auth.verifyOtp({ email: agent.email, token, type: "email" });
  if (error || data.user?.id !== userId) return { error: "That code did not work. Check the latest email, or send a new one." };
  redirect(await supportUrl("/setup"));
}

export async function startAgentEnrollment(): Promise<EnrollState> {
  const { supabase, methods, hasVerifiedTotp } = await requireAgentIdentity();
  if (hasVerifiedTotp) redirect(await supportUrl("/verify"));
  if (!hasRecentMailboxProof(methods)) return { needEmail: true, error: "Confirm your email first." };
  const { data: factors } = await supabase.auth.mfa.listFactors();
  // A setup started earlier and never finished is replaced (agents enrol from one device at a time).
  for (const f of factors?.all ?? []) if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: "BuPulse Support", friendlyName: `BuPulse Support ${Date.now().toString(36)}` });
  if (error || !data) return { error: "Could not start setup. Please try again." };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmAgentEnrollment(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const { agent, supabase } = await requireAgentIdentity();
  const code = await checkCode(agent.id, formData.get("code"));
  if (typeof code !== "string") return code;
  const factorId = String(formData.get("factorId") ?? "");
  const { data: factors } = await supabase.auth.mfa.listFactors();
  if (!factors?.all?.some((f) => f.id === factorId && f.status === "unverified")) return { error: "This setup expired. Reload the page and start again." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: "That code did not match. Check your phone's clock and try the next code." };
  redirect(await supportUrl("/"));
}

const LINK_TYPES = ["invite", "recovery", "magiclink"] as const;

/**
 * The invite or new-password link: opened with a button press (not on page load), so a mail scanner's visit does not
 * use it up. The link must belong to a support agent who is not locked; anyone else is signed out again.
 */
export async function openEmailLink(_prev: PasswordFlowState, formData: FormData): Promise<PasswordFlowState> {
  const tokenHash = String(formData.get("token_hash") ?? "");
  const type = LINK_TYPES.find((t) => t === formData.get("type"));
  const expired = { step: "start" as const, error: "This link has expired or was already used. Ask your supervisor for a new invite, or use Forgot password." };
  if (!type || !/^[A-Za-z0-9_-]{10,200}$/.test(tokenHash)) return expired;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error || !data.user) return expired;
  const user = { id: data.user.id, email: data.user.email ?? null, emailConfirmed: !!data.user.email_confirmed_at };
  const agent = await agentFor(user);
  const who = agentIdentity({ user, agent, methods: [{ method: type }] });
  if (!who.ok) {
    await supabase.auth.signOut();
    return { step: "start", error: who.note === "locked" ? "Your account is locked. Ask your supervisor to unlock it." : "This link is not for the support app." };
  }
  // A new password with an authenticator already set: its code first (Supabase asks for it before a password change).
  const { data: factors } = await supabase.auth.mfa.listFactors();
  return { step: factors?.totp?.some((f) => f.status === "verified") ? "code" : "password" };
}

/** The authenticator code inside the new-password steps. */
export async function passwordFlowCode(_prev: PasswordFlowState, formData: FormData): Promise<PasswordFlowState> {
  const result = await verifyInline(formData);
  return result.error ? { step: "code", error: result.error } : { step: "password" };
}

async function verifyInline(formData: FormData): Promise<{ error?: string }> {
  const { agent, supabase } = await requireAgentIdentity();
  const code = await checkCode(agent.id, formData.get("code"));
  if (typeof code !== "string") return code;
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.find((f) => f.status === "verified");
  if (!factor) return {};
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  return error ? { error: "That code did not match. Try the next code from your app." } : {};
}

const AGENT_PASSWORD_MIN = 10;

/** Choosing a password: only right after opening an emailed link (10 minutes). Then the authenticator (or the app). */
export async function setAgentPassword(_prev: PasswordFlowState, formData: FormData): Promise<PasswordFlowState> {
  const { supabase, methods, hasVerifiedTotp } = await requireAgentIdentity();
  if (!hasRecentMailboxProof(methods)) return { step: "start", error: "This link has expired. Open the latest email again, or use Forgot password." };
  const password = String(formData.get("password") ?? "");
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return { step: "password", error: parsed.error.issues[0].message };
  if (password.length < AGENT_PASSWORD_MIN) return { step: "password", error: `Use at least ${AGENT_PASSWORD_MIN} characters for the support app.` };
  if (password !== String(formData.get("confirm") ?? "")) return { step: "password", error: "The two passwords are not the same." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") return { step: "password", error: "Choose a password you have not used here before." };
    if (error.code === "weak_password") return { step: "password", error: "That password is too easy to guess. Try a longer one." };
    if (error.code === "insufficient_aal") return { step: "code", error: "Enter your authenticator code first." };
    return { step: "password", error: "Could not save the password. Please try again." };
  }
  redirect(await supportUrl(hasVerifiedTotp ? "/" : "/setup"));
}

export async function forgotAgentPassword(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const started = Date.now();
  const parsed = emailSchema.safeParse(String(formData.get("email") ?? ""));
  if (!parsed.success) return { error: "Enter your work email." };
  const limited = await publicLimited("forgotPassword", parsed.data);
  if (limited) return { error: limited };
  await sendAgentPasswordReset(parsed.data);
  await padTo(started, ANSWER_MS);
  return { sent: true };
}

export async function signOutAgent(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(await supportUrl("/sign-in?error=signed_out"));
}
