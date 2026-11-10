import { notFound } from "next/navigation";
import { chosen } from "@/components/admin/kit";
import { requirePermission } from "@/lib/admin/auth";
import type { WordsOverview } from "@/lib/training-lab/language";
import { labWords } from "@/lib/training-lab/language-reader";
import { WORD_LISTS, WordsView, type WordList } from "./view";

export const metadata = { title: "Training Lab words" };
export const dynamic = "force-dynamic";

export default async function TrainingLabWordsPage({ searchParams }: PageProps<"/admin/training-lab/words">) {
  const me = await requirePermission("ai"); // pages render alongside the layout, so check here too
  // The owner from ADMIN_EMAILS only, like the library; anyone else does not see the page exists.
  if (!me.isOwner || me.staffId) notFound();
  const sp = await searchParams;
  let overview: WordsOverview | null = null;
  try {
    overview = await labWords();
  } catch {
    overview = null;
  }
  return <WordsView overview={overview} list={chosen(sp, "list", WORD_LISTS, "wrong") as WordList} params={sp} />;
}
