// What the Training Lab did to an opened reel, from its plan: how many Lab examples the writer read, the owner's
// spellings fixed, the language notes still found and the "never" notes the clip checker used. Read-only, collapsed.

export type ReelLab = {
  examplesRead: number;
  fixes: { where: string; from: string; to: string }[];
  issues: string[];
  avoid: string[];
};

export function LabNotes({ lab }: { lab: ReelLab }) {
  const empty = !lab.examplesRead && !lab.fixes.length && !lab.issues.length && !lab.avoid.length;
  return (
    <details className="min-w-0 rounded-2xl border border-line px-4 py-1 text-[14px]">
      <summary className="min-h-11 cursor-pointer py-2.5 font-medium">What the Training Lab did to this reel</summary>
      {empty ? (
        <p className="pb-3 text-muted">Nothing: it was made before the Lab, or the Lab had nothing for it.</p>
      ) : (
        <dl className="flex min-w-0 flex-col gap-2 pb-3">
          <div>
            <dt className="text-[13px] text-muted">Lab examples read</dt>
            <dd>{lab.examplesRead}</dd>
          </div>
          {lab.fixes.length > 0 && (
            <div>
              <dt className="text-[13px] text-muted">Spellings fixed</dt>
              <dd>
                <ul className="list-disc pl-5">
                  {lab.fixes.map((f, i) => (
                    <li key={i} className="break-words">{f.where}: {f.from} → {f.to}</li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          {lab.issues.length > 0 && (
            <div>
              <dt className="text-[13px] text-muted">Language notes still found</dt>
              <dd>
                <ul className="list-disc pl-5">
                  {lab.issues.map((m, i) => (
                    <li key={i} className="break-words">{m}</li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          {lab.avoid.length > 0 && (
            <div>
              <dt className="text-[13px] text-muted">&quot;Never&quot; notes the checker used</dt>
              <dd>
                <ul className="list-disc pl-5">
                  {lab.avoid.map((a, i) => (
                    <li key={i} className="break-words">{a}</li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
        </dl>
      )}
    </details>
  );
}
