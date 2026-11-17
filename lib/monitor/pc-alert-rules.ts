// The server PC's miner check (docs/SELF_HOST.md, "Miner check"): scripts/self-host/windows/supervisor.mjs lists the
// running programs every 10 minutes and, when it finds something like the crypto-miner of 17 November 2026 (a fake
// "dlIhost" in %APPDATA%\DLL), posts it here once (POST /api/monitor/pc-alert; it counts the 24-hour repeat itself).
// This file checks the report and words the owner's message. Pure, no imports: tests/monitor/pc-alert.test.ts.

export const PC_ALERT_MAX_BYTES = 8_192;
export const PC_ALERT_MAX_FINDINGS = 10;

export const PC_ALERT_REASONS = ["lookalike", "dll-path", "dll-folder", "system-name-path", "memory"] as const;
export type PcAlertReason = (typeof PC_ALERT_REASONS)[number];

export type PcFinding = { name: string; path: string | null; pid: number | null; memMb: number | null; looksLike: string | null; reasons: PcAlertReason[] };
export type PcAlert = { kind: "suspicious-process"; findings: PcFinding[] };

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

const int = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);

function finding(v: unknown): PcFinding | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const name = text(o.name, 80);
  const reasons = [...new Set(Array.isArray(o.reasons) ? o.reasons : [])].filter((r): r is PcAlertReason => (PC_ALERT_REASONS as readonly unknown[]).includes(r));
  if (!name || !reasons.length) return null;
  return { name, path: text(o.path, 300), pid: int(o.pid, 1, 2 ** 32), memMb: int(o.memMb, 0, 16_000_000), looksLike: text(o.looksLike, 40), reasons };
}

export function parsePcAlert(raw: unknown): { ok: true; value: PcAlert } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Send a JSON object." };
  const o = raw as Record<string, unknown>;
  if (o.kind !== "suspicious-process") return { ok: false, error: 'kind must be "suspicious-process".' };
  if (!Array.isArray(o.findings)) return { ok: false, error: "findings must be a list." };
  const findings = o.findings.slice(0, PC_ALERT_MAX_FINDINGS).map(finding).filter((f): f is PcFinding => f !== null);
  if (!findings.length) return { ok: false, error: "findings has no valid finding." };
  return { ok: true, value: { kind: "suspicious-process", findings } };
}

const REASON_WORDS: Record<PcAlertReason, (f: PcFinding) => string> = {
  lookalike: (f) => `its name imitates the Windows program "${f.looksLike ?? "?"}"`,
  "dll-path": () => "it runs from AppData\\Roaming\\DLL, where the miner lived",
  "dll-folder": () => "the AppData\\Roaming\\DLL folder of the miner is back",
  "system-name-path": () => "a Windows program's name running from outside the Windows folder",
  memory: (f) => `it holds ${f.memMb !== null ? `${(f.memMb / 1024).toFixed(1)} GB` : "over 2 GB"} of memory`,
};

/** The owner's message: subject, one line (Telegram), and one block per finding (email). */
export function pcAlertText(a: PcAlert): { subject: string; heading: string; line: string; blocks: { label: string; value: string }[] } {
  const first = a.findings[0];
  const what = first.reasons.includes("dll-folder") && first.reasons.length === 1 ? "the miner's folder" : `"${first.name}"`;
  const more = a.findings.length > 1 ? ` and ${a.findings.length - 1} more` : "";
  return {
    subject: `Warning: possible crypto-miner on the server PC (${first.name})`,
    heading: "Possible crypto-miner on the server PC",
    line: `The server PC's supervisor found ${what}${more}: ${first.reasons.map((r) => REASON_WORDS[r](first)).join("; ")}. This is how the miner of 17 November looked. Run a Microsoft Defender full scan on the PC and scripts\\self-host\\windows\\persistence-check.ps1, and tell Claude.`,
    blocks: a.findings.map((f) => ({
      label: f.reasons.includes("dll-folder") && f.reasons.length === 1 ? "Folder" : `${f.name}${f.pid ? ` (PID ${f.pid})` : ""}`,
      value: [f.reasons.map((r) => REASON_WORDS[r](f)).join("; "), f.path ?? "path hidden (needs admin)"].join(". "),
    })),
  };
}
