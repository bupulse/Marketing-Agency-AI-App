import { SubjectPostsPage } from "@/components/content-board/subject-page";

export const metadata = { title: "General posts" };

export default async function GeneralPostsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SubjectPostsPage scope={{ kind: "general" }} searchParams={await searchParams} />;
}
