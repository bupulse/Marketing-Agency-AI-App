const HEX = /^#?([0-9a-f]{6})$/i;

export const PULSE_BLUE = "#2F6BFF";
export const PULSE_VIOLET = "#7B5CFF";
const LIGHT_TEXT = "#FFFFFF";
const DARK_TEXT = "#0B0B0F";

/** True for a 6-digit hex colour such as #2F6BFF. */
export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function channels(hex: string): [number, number, number] | null {
  const m = HEX.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance, 0 (black) to 1 (white). Invalid input counts as black. */
export function relativeLuminance(hex: string): number {
  const rgb = channels(hex) ?? [0, 0, 0];
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** White or near-black text, whichever reads better on the given background. */
export function readableTextColor(background: string): string {
  return contrastRatio(background, LIGHT_TEXT) >= contrastRatio(background, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
}

/** Up to three valid brand colours, padded with Pulse Blue and Pulse Violet. */
export function brandPalette(colors: readonly string[] | null | undefined): [string, string, string] {
  const valid = (colors ?? []).filter(isHexColor);
  const first = valid[0] ?? PULSE_BLUE;
  const second = valid[1] ?? (valid[0] ? valid[0] : PULSE_VIOLET);
  const third = valid[2] ?? second;
  return [first, second, third];
}
