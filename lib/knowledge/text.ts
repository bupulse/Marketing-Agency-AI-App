// Owner text made safe for an AI prompt. Pure, with no imports, so every Knowledge base module can use it.

/** Removes any run of three or more < or > (fence markers), again until none is left ("<<<<<<" or "<<x<"). */
export function stripFences(value: string): string {
  let text = value;
  for (let i = 0; i < 10; i++) {
    const next = text.replace(/<{3,}|>{3,}/g, "").replace(/[<>]{3,}/g, (run) => run.replace(/[<>]/g, ""));
    if (next === text) break;
    text = next;
  }
  return text;
}

/** One line of owner text: whitespace collapsed, fence markers removed, clipped with an ellipsis. */
export function clean(value: string | null | undefined, max = 300): string {
  const text = stripFences((value ?? "").replace(/\s+/g, " ")).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
