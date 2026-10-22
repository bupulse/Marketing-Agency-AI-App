import { pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { BackLink } from "@/components/knowledge/back-link";
import { QuizLink } from "@/components/knowledge/quiz-link";
import { ProfileForm } from "@/components/knowledge/profile-form";
import { readKnowledge } from "@/lib/brand/schemas";
import { prisma } from "@/lib/db";
import { industryOptions } from "@/lib/industries/server";
import { industryFormValues } from "@/lib/industries/shared";
import { profileFormValues } from "@/lib/knowledge/profile";

export const metadata = { title: "Company profile" };

export default async function ProfilePage() {
  const blocked = await pageGate("settings");
  if (blocked) return blocked;
  const { business } = await getAppContext();
  const sector = await prisma.business.findUnique({ where: { id: business.id }, select: { industryId: true, industryOther: true, industryDescription: true, industryRef: { select: { slug: true } } } });
  const industries = await industryOptions({ currentIndustryId: sector?.industryId });
  const initial = profileFormValues(
    { name: business.name, website: business.website, description: business.description, profile: business.profile, knowledgeArea: readKnowledge(business.knowledge).area },
    industryFormValues(sector ?? {}),
  );

  return (
    <>
      <BackLink />
      <PageHeader title="Company profile" description="Who you are, in your own words. BuPulse uses this in every post, plan and chat reply." action={<QuizLink round="you" />} />
      <ProfileForm industries={industries} initial={initial} />
    </>
  );
}
