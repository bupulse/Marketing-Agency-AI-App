import { SubjectPostsPage } from "@/components/content-board/subject-page";

export const metadata = { title: "Campaign posts" };

export default async function CampaignPostsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <SubjectPostsPage scope={{ kind: "campaign", id }} searchParams={query} />;
}
