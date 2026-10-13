import { AdminAuthShell as AuthShell } from "@/components/admin/auth-shell";
import { AdminLoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

const NOTES: Record<string, string> = {
  no_access: "The account you are signed in with has no admin access. Sign in with an admin email.",
  email_only: "The admin console needs your admin email and an emailed code (not Google), then your authenticator code.",
};

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const note = error ? NOTES[error] : undefined;
  return (
    <AuthShell>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Admin sign-in</h1>
        <p className="text-[15px] text-muted">Your admin email, then the code we email you, then the 6-digit code from your authenticator app.</p>
      </div>
      {note && <p className="rounded-2xl bg-soft px-4 py-3 text-sm text-text">{note}</p>}
      <AdminLoginForm />
    </AuthShell>
  );
}
