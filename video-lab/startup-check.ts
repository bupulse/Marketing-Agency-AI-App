// What the studio needs to be set before it opens to clients (docs/STUDIO_DEPLOY.md, section 4, item 11): checked at
// start when STUDIO_ENV=production. Errors stop the start; warnings say which feature is off. Names only, never values.
type Env = Record<string, string | undefined>;
const has = (env: Env, name: string) => !!env[name]?.trim();

export function checkStudioEnv(env: Env): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const name of ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "ENCRYPTION_KEY", "ANTHROPIC_API_KEY", "STUDIO_SESSION_SECRET", "STUDIO_URL"]) {
    if (!has(env, name)) errors.push(`${name} is not set.`);
  }
  if (has(env, "STUDIO_SESSION_SECRET") && (env.STUDIO_SESSION_SECRET as string).trim().length < 32) errors.push("STUDIO_SESSION_SECRET must be 32 or more characters (openssl rand -hex 32).");
  if (has(env, "STUDIO_URL") && !/^https:\/\/[^/\s]+\/?$/.test((env.STUDIO_URL as string).trim())) errors.push("STUDIO_URL must be the https address of the studio (https://studio.bupulse.com).");
  if (has(env, "BUPULSE_URL") && !/^https:\/\/[^/\s]+\/?$/.test((env.BUPULSE_URL as string).trim())) errors.push("BUPULSE_URL must be the https address of BuPulse (https://bupulse.com).");
  if (env.STUDIO_DEV_TICKETS === "1") errors.push("STUDIO_DEV_TICKETS must be empty in production (test tickets sign anyone in).");
  if (env.VIDEO_LAB_CLAUDE === "subscription") errors.push("VIDEO_LAB_CLAUDE=subscription is for tests only: production uses the API key.");
  if (has(env, "VIRAL_ROWS_DIR") || has(env, "VIRAL_FRAMES_DIR")) warnings.push("VIRAL_ROWS_DIR / VIRAL_FRAMES_DIR are test settings: leave them empty.");
  if (!has(env, "STUDIO_PASSWORD")) warnings.push("STUDIO_PASSWORD is not set: the owner's door (/login) is closed.");
  if (!has(env, "ELEVENLABS_API_KEY")) warnings.push("ELEVENLABS_API_KEY is not set: voice-overs are off.");
  if (!has(env, "GEMINI_API_KEY")) warnings.push("GEMINI_API_KEY is not set: AI images and presenter shots are off.");
  if (!has(env, "SEEDANCE_API_KEY")) warnings.push("SEEDANCE_API_KEY is not set: Seedance stays in free preview mode.");
  return { errors, warnings };
}
