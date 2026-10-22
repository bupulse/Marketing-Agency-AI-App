import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPatch, checkAllow, checkSite, checkTemplate, FIELDS, loadTemplates, parseArgs, summarize, warnings } from "../../scripts/supabase-auth-emails.mjs";

// The branded Supabase emails (supabase/templates) and the script that installs them (scripts/supabase-auth-emails.mjs).

const dir = join(__dirname, "..", "..", "supabase", "templates");
const read = (file: string) => readFileSync(join(dir, file), "utf8");
const REF = "abcdefghijklmnopqrst";

describe("auth email templates", () => {
  const subjects = JSON.parse(read("subjects.json")) as Record<string, { file: string; subject: string }>;

  it("lists a file and a subject for every email the script installs", () => {
    expect(Object.keys(subjects).sort()).toEqual(Object.keys(FIELDS).sort());
    expect(subjects.magic_link.subject).toBe("Your BuPulse admin code");
  });

  it.each([
    ["confirm-signup.html", "type=email"],
    ["reset-password.html", "type=recovery&amp;next=/reset-password"],
    ["email-change.html", "type=email_change&amp;next=/dashboard/settings"],
  ])("%s shows the code and links to /auth/confirm on the Site URL", (file, type) => {
    const html = read(file);
    expect(html).toContain("{{ .Token }}");
    expect(html).toContain(`href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;${type}"`);
    expect(html).not.toContain("{{ .ConfirmationURL }}");
    expect(html).not.toMatch(/localhost/);
  });

  it("the sign-up email carries no fixed next (the route follows the sign-up's own) and suits creators too", () => {
    const html = read("confirm-signup.html");
    expect(html).not.toMatch(/token_hash=\{\{ \.TokenHash \}\}&amp;type=email&amp;next=/);
    expect(html).toContain("{{ if .Data.account_kind }}");
  });

  it("the admin code email has the code and no sign-in link", () => {
    const html = read("magic-link.html");
    expect(html).toContain("{{ .Token }}");
    expect(html).not.toMatch(/ConfirmationURL|TokenHash|href="\{\{/);
    expect(html.replace(/BlinkMacSystemFont/g, "")).not.toMatch(/\blink\b/i); // no "follow the link" wording
  });

  it("every template passes the script's own checks", () => {
    expect(() => loadTemplates(dir)).not.toThrow();
  });
});

describe("install script", () => {
  it("reads the ref and options", () => {
    expect(parseArgs([REF, "--site", "https://test.bupulse.com/", "--allow", "https://test.bupulse.com/**, http://localhost:3001/**", "--otp-length", "6", "--dry-run"])).toEqual({
      ref: REF,
      site: "https://test.bupulse.com",
      allow: "https://test.bupulse.com/**,http://localhost:3001/**",
      otpLength: 6,
      otpExp: null,
      dryRun: true,
    });
  });

  it.each([
    [[]],
    [["not-a-ref"]],
    [[REF, "--otp-length", "12"]],
    [[REF, "--otp-exp", "999999"]],
    [[REF, "--site"]],
    [[REF, "--force"]],
  ])("refuses %j", (argv) => {
    expect(() => parseArgs(argv)).toThrow();
  });

  it("accepts https sites and redirect patterns, http only for localhost", () => {
    expect(checkSite("http://localhost:3001")).toBe("http://localhost:3001");
    expect(() => checkSite("http://test.bupulse.com")).toThrow();
    expect(() => checkSite("https://bupulse.com/auth")).toThrow();
    expect(() => checkAllow("http://evil.example/**")).toThrow();
    expect(() => checkAllow("bupulse.com")).toThrow();
    expect(checkAllow("https://bupulse.com/**,https://bupulse.com/**")).toBe("https://bupulse.com/**");
  });

  it("refuses a template without the code, with Supabase's own link, or an admin email with a link", () => {
    expect(() => checkTemplate("confirmation", '<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email">x</a>')).toThrow(/Token/);
    expect(() => checkTemplate("recovery", "{{ .Token }} {{ .ConfirmationURL }}")).toThrow(/auth\/confirm/);
    expect(() => checkTemplate("magic_link", '{{ .Token }} <a href="{{ .ConfirmationURL }}">x</a>')).toThrow(/link/);
  });

  it("sends every template and subject, and URLs or OTP settings only when given", () => {
    const templates = loadTemplates(dir);
    const patch = buildPatch(templates, { site: null, allow: null, otpLength: null, otpExp: null });
    expect(Object.keys(patch).sort()).toEqual(Object.values(FIELDS).flatMap((f) => [f.subject, f.content]).sort());
    const full = buildPatch(templates, { site: "https://bupulse.com", allow: "https://bupulse.com/**", otpLength: 6, otpExp: 86400 });
    expect(full).toMatchObject({ site_url: "https://bupulse.com", uri_allow_list: "https://bupulse.com/**", mailer_otp_length: 6, mailer_otp_exp: 86400 });
  });

  it("the dry-run summary shows lengths and settings, never the email bodies", () => {
    const templates = loadTemplates(dir);
    const patch = buildPatch(templates, { site: "https://test.bupulse.com", allow: null, otpLength: null, otpExp: null });
    const current = { site_url: "http://localhost:3001", uri_allow_list: "http://localhost:3001/**", mailer_otp_exp: 3600, mailer_subjects_recovery: "Reset your BuPulse password", mailer_templates_recovery_content: "<p>old</p>" };
    const lines = summarize(current, patch).join("\n");
    expect(lines).toContain('site_url: "http://localhost:3001" → "https://test.bupulse.com"');
    expect(lines).toContain('uri_allow_list: kept ("http://localhost:3001/**")');
    expect(lines).toContain("mailer_subjects_recovery: unchanged");
    expect(lines).toMatch(/mailer_templates_recovery_content: 10 → \d+ characters/);
    expect(lines).not.toContain("<");
    expect(warnings(current, patch).join(" ")).toMatch(/24 hours/);
    expect(warnings({ site_url: "http://localhost:3001" }, {}).join(" ")).toMatch(/localhost/);
  });
});
