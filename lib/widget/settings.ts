import { z } from "zod";
import { isHexColor } from "@/lib/color-contrast";
import { normalizeDomains } from "./origin";

export const MAX_GREETING_LENGTH = 300;

export const widgetSettingsSchema = z.object({
  enabled: z.boolean(),
  greeting: z.string().trim().max(MAX_GREETING_LENGTH, `Please keep the greeting under ${MAX_GREETING_LENGTH} characters.`),
  position: z.enum(["right", "left"]),
  accentColor: z.string().trim().refine((v) => v === "" || isHexColor(v), "Choose a colour like #2F6BFF."),
  allowedDomains: z.array(z.string().max(300)).max(40),
});

export type WidgetSettingsInput = z.input<typeof widgetSettingsSchema>;

export type WidgetSettingsResult =
  | { ok: true; data: { enabled: boolean; greeting: string | null; position: "right" | "left"; accentColor: string | null; allowedDomains: string[] } }
  | { ok: false; errors: Record<string, string> };

/** Validates the settings form. Empty greeting/colour mean "use the default". */
export function validateWidgetSettings(input: unknown): WidgetSettingsResult {
  const parsed = widgetSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, errors };
  }
  const { domains, invalid } = normalizeDomains(parsed.data.allowedDomains);
  if (invalid.length) return { ok: false, errors: { allowedDomains: `"${invalid[0]}" is not a website address. Use something like mysite.com.` } };
  const d = parsed.data;
  return {
    ok: true,
    data: { enabled: d.enabled, greeting: d.greeting || null, position: d.position, accentColor: d.accentColor ? d.accentColor.toUpperCase() : null, allowedDomains: domains },
  };
}

/** The install snippet owners paste into their site. */
export function installSnippet(siteUrl: string, key: string): string {
  return `<script src="${siteUrl.replace(/\/$/, "")}/widget.js" data-key="${key}" async></script>`;
}
