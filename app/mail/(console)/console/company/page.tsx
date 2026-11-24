import { CompanyView } from "@/components/mail/console-company";
import { prisma } from "@/lib/db";
import { companyForPreview } from "@/lib/mail/console-data";
import { requireMailAdmin } from "@/lib/mail/session";

export const metadata = { title: "Company and look" };

export default async function MailConsoleCompanyPage() {
  await requireMailAdmin();
  const [settings, company, users] = await Promise.all([
    prisma.mailSettings.findUnique({ where: { id: "default" }, select: { glassClarity: true, glassTint: true, usersChangeGlass: true, defaultTemplate: true } }),
    companyForPreview(),
    prisma.mailMember.count(),
  ]);
  return (
    <CompanyView
      company={company}
      look={{ clarity: settings?.glassClarity ?? 60, tint: settings?.glassTint ?? "light", usersChange: settings?.usersChangeGlass ?? true, template: settings?.defaultTemplate ?? "classic" }}
      users={users}
    />
  );
}
