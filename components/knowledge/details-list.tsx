/** Label / value rows for a product's or campaign's page; empty values are left out. */
export function DetailsList({ rows }: { rows: [string, string | string[] | null | undefined][] }) {
  const shown = rows.filter(([, v]) => (Array.isArray(v) ? v.length > 0 : !!v));
  if (shown.length === 0) return null;
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {shown.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-[13px] text-muted">{label}</dt>
          <dd className="text-[15px] break-words">
            {Array.isArray(value) ? (
              <ul className="mt-1 flex flex-col gap-1">
                {value.map((v) => (
                  <li key={v} className="flex gap-2">
                    <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-pulse-blue" />
                    {v}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="whitespace-pre-wrap">{value}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
