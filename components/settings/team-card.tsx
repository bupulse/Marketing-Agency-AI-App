import Link from "next/link";
import { Users } from "lucide-react";
import { BPanel } from "@/components/app/kit/b-cards";
import { buttonClasses } from "@/components/ui";
import { ROLE_LABEL, type Role } from "@/lib/team/roles";

export function TeamCard({ role, canManage, members }: { role: Role; canManage: boolean; members: number }) {
  return (
    <BPanel
      id="team"
      icon={Users}
      tone="indigo"
      title="Team"
      hint={`${members} ${members === 1 ? "user" : "users"} in your company. You are ${role === "ADMIN" ? "an" : "a"} ${ROLE_LABEL[role]}.${canManage ? " Invite colleagues, change roles or hand over ownership." : " Ask your company owner to invite or remove people."}`}
      aside={
        canManage ? (
          <Link href="/dashboard/settings/team" className={buttonClasses({ variant: "outline", size: "sm" })}>
            Manage team
          </Link>
        ) : undefined
      }
    />
  );
}
