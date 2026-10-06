import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import LoginForm from "./LoginForm";

// Unstyled on purpose: the real design comes after auth works end to end.
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/dashboard";
  if (await getCurrentUser()) redirect(next);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Sign in to BuPulse</h1>
      {params.error && <p role="alert">Sign-in failed. Please try again.</p>}
      <LoginForm next={next} />
      <p className="text-sm">New here? Signing in starts your 7-day free trial.</p>
    </main>
  );
}
