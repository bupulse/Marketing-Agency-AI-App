import { cn } from "@/lib/cn";

type RotatingWordsProps = {
  /** Words to cycle through, e.g. ["shop.", "school.", "salon."]. Needs 2+. */
  words: string[];
  /** Seconds each word stays on screen. */
  hold?: number;
  className?: string;
  /** Applied to each word. Put text effects such as `text-gradient` here: on the wrapper,
   * background-clip:text would paint through the hidden words too. */
  wordClassName?: string;
};

/**
 * Hero word rotator. Screen readers get one static sentence fragment (all words, comma-separated);
 * the animated copy is aria-hidden. Reduced motion shows only the first word.
 */
export function RotatingWords({ words, hold = 2.4, className, wordClassName }: RotatingWordsProps) {
  const n = words.length;
  const total = n * hold;
  const slot = 100 / n;
  const enter = Math.min(5, slot / 3);
  const name = `bp-words-${n}`;
  const keyframes = `@keyframes ${name}{0%{opacity:0;transform:translateY(70%)}${enter}%{opacity:1;transform:none}${
    slot - enter
  }%{opacity:1;transform:none}${slot}%{opacity:0;transform:translateY(-70%)}100%{opacity:0;transform:translateY(-70%)}}`;

  if (n < 2) return <span className={className}>{words[0]}</span>;

  return (
    <>
      <style href={name} precedence="default">
        {keyframes}
      </style>
      <span className="sr-only">{words.join(", ")}</span>
      <span
        aria-hidden
        className={cn("bp-rotator", className)}
        style={{ "--bp-words": name, "--bp-dur": `${total}s` } as React.CSSProperties}
      >
        {words.map((w, i) => (
          <span key={w + i} style={{ animationDelay: `${i * hold}s` }}>
            <span className={wordClassName}>{w}</span>
          </span>
        ))}
      </span>
    </>
  );
}
