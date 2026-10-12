// Owner text made safe for an AI prompt. Pure, with no imports, so every Knowledge base module can use it.

/** One line of owner text: whitespace collapsed, fence markers removed, clipped with an ellipsis. */
export function clean(value: string | null | undefined, max = 300): string {
  const text = (value ?? "").replace(/<<<|>>>/g, "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
