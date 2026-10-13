// Autopilot settings: validation and the mapping between the form and AutopilotSettings.
import { z } from "zod";
import { minutesOf } from "./timezone";

export const MIN_POSTS_PER_WEEK = 2;
export const MAX_POSTS_PER_WEEK = 14;
export const MAX_POSTING_TIMES = 4;
export const DEFAULT_POSTING_TIMES = ["09:00", "18:00"];

export interface AutopilotConfig {
  enabled: boolean;
  autoPublish: boolean;
  postsPerWeek: number;
  connectionIds: string[];
  /** Local "HH:mm" times (Business.timezone) Autopilot may post at. */
  postingTimes: string[];
  useAiImages: boolean;
  skipReligious: boolean;
}

export const DEFAULT_CONFIG: AutopilotConfig = {
  enabled: false,
  autoPublish: false,
  postsPerWeek: 3,
  connectionIds: [],
  postingTimes: DEFAULT_POSTING_TIMES,
  // Posts show people (docs/CONTENT_VISUALS.md): AI photos are on unless the owner turns them off.
  useAiImages: true,
  skipReligious: false,
};

type Row = {
  enabled: boolean;
  autoPublish: boolean;
  postsPerWeek: number;
  connectionIds: string[];
  postingTimes: string[];
  useAiImages: boolean;
  skipReligiousHolidays: boolean;
};

/** The stored row (or none yet) as the config the planner and the page use. */
export function readConfig(row: Row | null | undefined): AutopilotConfig {
  if (!row) return DEFAULT_CONFIG;
  const times = row.postingTimes.filter((t) => minutesOf(t) !== null);
  return {
    enabled: row.enabled,
    autoPublish: row.autoPublish,
    postsPerWeek: Math.min(MAX_POSTS_PER_WEEK, Math.max(MIN_POSTS_PER_WEEK, row.postsPerWeek)),
    connectionIds: row.connectionIds,
    postingTimes: times.length > 0 ? times : DEFAULT_POSTING_TIMES,
    useAiImages: row.useAiImages,
    skipReligious: row.skipReligiousHolidays,
  };
}

/** The database columns for a config. */
export function toRow(config: AutopilotConfig): Row {
  return {
    enabled: config.enabled,
    autoPublish: config.autoPublish,
    postsPerWeek: config.postsPerWeek,
    connectionIds: config.connectionIds,
    postingTimes: config.postingTimes,
    useAiImages: config.useAiImages,
    skipReligiousHolidays: config.skipReligious,
  };
}

const time = z.string().refine((t) => minutesOf(t) !== null, "Use a time like 09:00.");

export const settingsSchema = z.object({
  enabled: z.boolean(),
  autoPublish: z.boolean(),
  postsPerWeek: z
    .number()
    .int()
    .min(MIN_POSTS_PER_WEEK, `Choose at least ${MIN_POSTS_PER_WEEK} posts a week.`)
    .max(MAX_POSTS_PER_WEEK, `Choose at most ${MAX_POSTS_PER_WEEK} posts a week.`),
  connectionIds: z.array(z.string().min(1).max(64)).max(20),
  postingTimes: z
    .array(time)
    .min(1, "Pick at least one posting time.")
    .max(MAX_POSTING_TIMES, `Pick up to ${MAX_POSTING_TIMES} posting times.`)
    .transform((times) => [...new Set(times)].sort()),
  useAiImages: z.boolean(),
  skipReligious: z.boolean(),
});

export type SettingsInput = z.input<typeof settingsSchema>;
