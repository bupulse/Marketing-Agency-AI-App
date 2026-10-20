import { describe, expect, it } from "vitest";
import { checkStudioEnv } from "@/video-lab/startup-check";

const good = {
  DATABASE_URL: "postgresql://x",
  NEXT_PUBLIC_SUPABASE_URL: "https://p.supabase.co",
  SUPABASE_SECRET_KEY: "key-value-0123456789",
  ENCRYPTION_KEY: "enc-value-0123456789",
  ANTHROPIC_API_KEY: "sk-ant-secret-0123456789",
  STUDIO_SESSION_SECRET: "a".repeat(64),
  STUDIO_URL: "https://studio.bupulse.com",
  BUPULSE_URL: "https://bupulse.com",
  STUDIO_PASSWORD: "pw",
  ELEVENLABS_API_KEY: "e",
  GEMINI_API_KEY: "g",
  SEEDANCE_API_KEY: "s",
};

describe("studio production environment", () => {
  it("passes a complete setup with no warnings", () => {
    expect(checkStudioEnv(good)).toEqual({ errors: [], warnings: [] });
  });

  it("stops the start when a required variable is missing, naming it and never a value", () => {
    const { errors } = checkStudioEnv({});
    expect(errors).toEqual(["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "ENCRYPTION_KEY", "ANTHROPIC_API_KEY", "STUDIO_SESSION_SECRET", "STUDIO_URL"].map((n) => `${n} is not set.`));
    expect(JSON.stringify(checkStudioEnv({ ...good, STUDIO_SESSION_SECRET: "short" }))).not.toContain("short");
  });

  it("refuses a short session secret, a non-https address, test tickets and the Claude subscription", () => {
    expect(checkStudioEnv({ ...good, STUDIO_SESSION_SECRET: "short" }).errors).toEqual(["STUDIO_SESSION_SECRET must be 32 or more characters (openssl rand -hex 32)."]);
    expect(checkStudioEnv({ ...good, STUDIO_URL: "http://studio.bupulse.com" }).errors[0]).toContain("STUDIO_URL");
    expect(checkStudioEnv({ ...good, BUPULSE_URL: "bupulse.com" }).errors[0]).toContain("BUPULSE_URL");
    expect(checkStudioEnv({ ...good, STUDIO_DEV_TICKETS: "1" }).errors[0]).toContain("STUDIO_DEV_TICKETS");
    expect(checkStudioEnv({ ...good, VIDEO_LAB_CLAUDE: "subscription" }).errors[0]).toContain("VIDEO_LAB_CLAUDE");
  });

  it("only warns when an optional service is missing", () => {
    const { errors, warnings } = checkStudioEnv({ ...good, ELEVENLABS_API_KEY: "", GEMINI_API_KEY: "", SEEDANCE_API_KEY: "", STUDIO_PASSWORD: "" });
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(4);
  });
});
