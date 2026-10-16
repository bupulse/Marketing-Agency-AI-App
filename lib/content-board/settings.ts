// Content -> Settings (docs/CONTENT.md): per app, whether new posts wait for the owner's approval. Stored as
// Business.contentSettings (JSON), validated here. Pure and client-safe, so the page, the actions and the tests share it.
import { z } from "zod";
import { NETWORKS, type Network } from "@/lib/social/types";
import { DEFAULT_VOICE_ID, isVoiceId } from "@/lib/voice/voices";

export interface ContentSettings {
  /** true: new posts for this app wait as "Needs review". false: they are scheduled at the best time on their own. */
  requireApproval: Record<Network, boolean>;
  /** Posts in a content pack ("Write content" makes this many different posts, docs/CONTENT_PACKS.md): 3 to 7. */
  packSize: number;
  /** The voice of video voiceovers (lib/voice/voices.ts; docs/VOICE_AND_MUSIC.md). */
  voiceId: string;
}

export const PACK_SIZE = { min: 3, max: 7, default: 5 } as const;

/** Approval required for every app until an Owner or Admin changes it. */
export const DEFAULT_CONTENT_SETTINGS: ContentSettings = {
  requireApproval: Object.fromEntries(NETWORKS.map((n) => [n, true])) as Record<Network, boolean>,
  packSize: PACK_SIZE.default,
  voiceId: DEFAULT_VOICE_ID,
};

export const contentSettingsSchema = z
  .object({
    requireApproval: z.object(Object.fromEntries(NETWORKS.map((n) => [n, z.boolean()])) as Record<Network, z.ZodBoolean>).partial().strict(),
    packSize: z.number().int().min(PACK_SIZE.min).max(PACK_SIZE.max).optional(),
    voiceId: z.string().refine(isVoiceId).optional(),
  })
  .strict();

export type ContentSettingsInput = z.input<typeof contentSettingsSchema>;

/** The stored JSON as full settings: anything missing or unreadable means "approval required". */
export function readContentSettings(value: unknown): ContentSettings {
  const parsed = contentSettingsSchema.safeParse(value ?? {});
  const stored = parsed.success ? parsed.data.requireApproval : {};
  return { requireApproval: { ...DEFAULT_CONTENT_SETTINGS.requireApproval, ...stored }, packSize: (parsed.success && parsed.data.packSize) || PACK_SIZE.default, voiceId: (parsed.success && parsed.data.voiceId) || DEFAULT_VOICE_ID };
}

/** Whether a new post for this network waits for approval. Unknown networks always do. */
export function requiresApproval(settings: ContentSettings, network: string): boolean {
  return (NETWORKS as readonly string[]).includes(network) ? settings.requireApproval[network as Network] !== false : true;
}

/** Apps whose posts go out without approval, for the page and the audit log. */
export function autoApps(settings: ContentSettings): Network[] {
  return NETWORKS.filter((n) => settings.requireApproval[n] === false);
}
