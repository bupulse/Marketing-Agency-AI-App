import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";

// "Users" became "Companies" (a company has several users). Old links keep working.
export default async function UsersRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const k of ["q", "plan", "status"]) if (typeof sp[k] === "string") qs.set(k, sp[k]);
  redirect(`/admin/companies${qs.size ? `?${qs}` : ""}`);
}
