import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { JoinNewForm, JoinSignedInForm } from "@/components/creators/portal/join-form";
import { Button } from "@/components/ui";
import { previewJoin } from "@/lib/creators/join";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Join the campaign",
  robots: { index: false, follow: false },
};

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <AuthShell>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">{title}</h1>
        <p className="text-[15px] text-muted">{text}</p>
      </div>
      <Button href="/login?next=/creator" variant="outline" className="w-full">Go to sign in</Button>
    </AuthShell>
  );
}

// The invite link a selected creator gets by email (docs/CREATOR_CAMPAIGNS.md, "People and links").
export default async function JoinPage({ params }: PageProps<"/creator/join/[token]">) {
  const { token } = await params;
  const invite = await previewJoin(token);
  if (invite.status === "unknown") return <Notice title="This link is not valid" text="Check that you opened the full link from the email, or ask the company to send a new one." />;
  if (invite.status === "used") return <Notice title="This invitation was already used" text="If that was you, sign in to see the campaign." />;
  if (invite.status !== "valid") return <Notice title="This invitation has expired" text="Invitations last 14 days. Ask the company to send you a new one." />;

  const signedIn = await getCurrentUser();
  const sameEmail = signedIn?.email?.toLowerCase() === invite.email;
  return (
    <AuthShell>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Join {invite.campaignName}</h1>
        <p className="text-[15px] text-muted">
          {invite.companyName} picked you for their creator campaign. {sameEmail || invite.hasLogin ? "Add it to your BuPulse login to see the tasks." : `Make your creator login for ${invite.email} to see the tasks.`}
        </p>
      </div>
      {signedIn && sameEmail ? (
        <JoinSignedInForm token={token} />
      ) : signedIn ? (
        <>
          <p role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm font-medium">
            You are signed in as {signedIn.email}, but this invitation is for {invite.email}. Sign out, then open the link again.
          </p>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="outline" className="w-full">Sign out</Button>
          </form>
        </>
      ) : invite.hasLogin ? (
        <>
          <p className="text-sm">{invite.email} already has a BuPulse login. Sign in with it, and the campaign is added.</p>
          <Button href={`/login?email=${encodeURIComponent(invite.email)}&next=${encodeURIComponent(`/creator/join/${token}`)}`} className="w-full">
            Sign in
          </Button>
        </>
      ) : (
        <JoinNewForm token={token} email={invite.email} name={invite.name} />
      )}
    </AuthShell>
  );
}
