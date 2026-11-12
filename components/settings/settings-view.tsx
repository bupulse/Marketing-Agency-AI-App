import type { ReactNode } from "react";
import { Building2, Settings, Trash2, UserRound, Users } from "lucide-react";
import { ChoiceTiles, HashRedirect, KitStyles, PageHeader, type ChoiceOption } from "@/components/admin/kit";
import { DeleteAccount } from "@/components/settings/delete-account";
import { BusinessSection, ProfileSection, type BusinessDetailsValues } from "@/components/settings/settings-form";
import { TeamCard } from "@/components/settings/team-card";
import type { Role } from "@/lib/team/roles";

export const SETTINGS_PARTS = ["you", "company", "team", "account"] as const;
export type SettingsPart = (typeof SETTINGS_PARTS)[number];

/**
 * /dashboard/settings: four cards to choose from (you, your company, team and apps, close account), then only that
 * part. Presentational: the page passes the data in; `canva` and `devChecks` are server pieces passed as they are.
 */
export function SettingsView({
  part,
  base = "/dashboard/settings",
  params,
  profile,
  business,
  team,
  remove,
  canva,
  devChecks,
}: {
  part: SettingsPart;
  base?: string;
  params?: Record<string, string | string[] | undefined>;
  profile: { name: string; email: string; signInMethod: string };
  /** Null when the person may not change the company's details (lib/team/roles.ts "settings"). */
  business: { defaults: BusinessDetailsValues; country: string; industryLabel: string } | null;
  team: { role: Role; canManage: boolean; members: number };
  remove: { email: string; wholeCompany: boolean; teammates: number };
  canva?: ReactNode;
  devChecks?: ReactNode;
}) {
  const shown: SettingsPart = part === "company" && !business ? "you" : part;
  const options: ChoiceOption[] = [
    { value: "you", label: "You", hint: "Your name and sign-in", icon: UserRound, tone: "blue" },
    ...(business ? [{ value: "company", label: "Company", hint: "Name, phone, website", icon: Building2, tone: "indigo" as const }] : []),
    { value: "team", label: "Team & apps", hint: `${team.members} ${team.members === 1 ? "user" : "users"} · Canva`, icon: Users, tone: "violet" },
    { value: "account", label: "Close account", hint: "Delete your account", icon: Trash2, tone: "slate" },
  ];
  return (
    <>
      <KitStyles />
      <HashRedirect to={{ business: `${base}?part=company`, team: `${base}?part=team`, canva: `${base}?part=team`, danger: `${base}?part=account` }} />
      <PageHeader icon={Settings} tone="slate" title="Settings" description="Your account and your company's details. Pick what to change." />
      <ChoiceTiles label="Settings" param="part" base={base} params={params} current={shown} allValue="you" options={options} />
      <div key={shown} className="kit-rise flex flex-col gap-6">
        {shown === "you" && <ProfileSection name={profile.name} email={profile.email} signInMethod={profile.signInMethod} />}
        {shown === "company" && business && <BusinessSection country={business.country} industryLabel={business.industryLabel} defaults={business.defaults} />}
        {shown === "team" && (
          <>
            <TeamCard role={team.role} canManage={team.canManage} members={team.members} />
            {canva}
          </>
        )}
        {shown === "account" && (
          <>
            <DeleteAccount email={remove.email} wholeCompany={remove.wholeCompany} teammates={remove.teammates} />
            {devChecks}
          </>
        )}
      </div>
    </>
  );
}
