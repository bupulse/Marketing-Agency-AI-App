import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { InviteForm } from "@/components/team/invite-form";
import { Button } from "@/components/ui";
import { getCurrentUser } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/team/roles";
import { previewInvite } from "@/lib/team/service";

export const metadata: Metadata = {
  title: "Join your team",
  robots: { index: false, follow: false },
};

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <AuthShell>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">{title}</h1>
        <p className="text-[15px] text-muted">{text}</p>
      </div>
      <Button href="/login" variant="outline" className="w-full">Go to sign in</Button>
    </AuthShell>
  );
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await previewInvite(token);
  if (invite.status === "unknown") return <Notice title="This link is not valid" text="Check that you opened the full link from your invitation email, or ask your company to send a new one." />;
  if (invite.status === "used") return <Notice title="This invitation was already used" text="If that was you, sign in to continue. Otherwise ask your company to send a new invitation." />;
  if (invite.status === "expired") return <Notice title="This invitation has expired" text="Invitations last 7 days. Ask your company to send you a new one." />;

  if (invite.status !== "valid") return <Notice title="This link is not valid" text="Ask your company to send a new invitation." />;
  const signedIn = await getCurrentUser();
  return (
    <AuthShell>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Join {invite.businessName}</h1>
        <p className="text-[15px] text-muted">
          {invite.inviterName ? `${invite.inviterName} invited` : "You were invited"} {invite.email} to work with {invite.businessName} on BuPulse as {invite.role === "ADMIN" ? "an" : "a"} {ROLE_LABEL[invite.role]}.
        </p>
      </div>
      {signedIn ? (
        <>
          <p role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm font-medium">
            You are signed in as {signedIn.email}. In this version a person can belong to one company only. Sign out to accept this invitation with a new account for {invite.email}.
          </p>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="outline" className="w-full">Sign out</Button>
          </form>
        </>
      ) : (
        <InviteForm token={token} email={invite.email} />
      )}
    </AuthShell>
  );
}
