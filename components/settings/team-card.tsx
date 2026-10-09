import Link from "next/link";
import { Users } from "lucide-react";
import { buttonClasses, GlassCard } from "@/components/ui";
import { ROLE_LABEL, type Role } from "@/lib/team/roles";

export function TeamCard({ role, canManage, members }: { role: Role; canManage: boolean; members: number }) {
  return (
    <GlassCard as="section" aria-labelledby="team" className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:p-6">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-soft">
        <Users aria-hidden className="size-5 text-muted" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 id="team" className="text-lg font-semibold">
          Team
        </h2>
        <p className="text-sm text-muted">
          {members} {members === 1 ? "user" : "users"} in your company. You are {role === "ADMIN" ? "an" : "a"} {ROLE_LABEL[role]}.
          {canManage ? " Invite colleagues, change roles or hand over ownership." : " Ask your company owner to invite or remove people."}
        </p>
      </div>
      {canManage && (
        <Link href="/dashboard/settings/team" className={buttonClasses({ variant: "outline" })}>
          Manage team
        </Link>
      )}
    </GlassCard>
  );
}
