import { SubjectPostsPage } from "@/components/content-board/subject-page";

export const metadata = { title: "Product posts" };

export default async function ProductPostsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <SubjectPostsPage scope={{ kind: "product", id }} searchParams={query} />;
}
