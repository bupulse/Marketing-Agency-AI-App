import Link from "next/link";

// Placeholder until the marketing site is built from the approved mockup.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold">BuPulse</h1>
      <p>The AI marketing team for every small business.</p>
      <div className="flex gap-4">
        <Link className="underline" href="/login">Sign in</Link>
        <Link className="underline" href="/dashboard">Dashboard</Link>
      </div>
    </main>
  );
}
