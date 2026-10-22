import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import type { QuizRoundId } from "@/lib/knowledge/quiz-map";

/** "Do it as a quiz" in a Business info section's header: the quiz, opened at the section's round. */
export function QuizLink({ round }: { round: QuizRoundId }) {
  return (
    <Button href={`/dashboard/knowledge/quiz?round=${round}`} variant="ghost" size="sm" leading={<Sparkles aria-hidden className="size-4 text-pulse-violet" />}>
      Do it as a quiz
    </Button>
  );
}
