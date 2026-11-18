import "server-only";
import { logError } from "@/lib/errors";
import { sendOwnerAlert, type AlertOutcome, type OwnerAlert } from "./alerts";
import { pcAlertText, type PcAlert } from "./pc-alert-rules";
import { delivered } from "./watch-rules";

// The server PC's miner alert (POST /api/monitor/pc-alert, from scripts/self-host/windows/supervisor.mjs). The supervisor
// sends each finding once and again at most every 24 hours (it keeps that count), so this only sends the message:
// Telegram and email, the same channels as the down alert (lib/monitor/alerts.ts).

type Deps = { send?: (a: OwnerAlert) => Promise<Record<string, AlertOutcome>> };

export async function sendPcAlert(alert: PcAlert, deps: Deps = {}): Promise<{ sent: boolean; outcomes: Record<string, AlertOutcome> }> {
  const send = deps.send ?? sendOwnerAlert;
  const { subject, heading, line, blocks } = pcAlertText(alert);
  let outcomes: Record<string, AlertOutcome>;
  try {
    outcomes = await send({ subject, heading, line, blocks, emoji: "🚨", footer: "Checked by the server PC's supervisor every 10 minutes. The same finding is sent again at most once a day.",
      // Public (GitHub backup): the count only, never a program's name or path (a path carries the Windows user name).
      backupText: `Security alert on the server PC (${alert.findings.length} ${alert.findings.length === 1 ? "finding" : "findings"}). Details by email and on the support app's Server page.`,
    });
  } catch (error) {
    outcomes = { email: "failed", telegram: "failed" };
    await logError(error, { source: "monitor.pc-alert", level: "warn" });
  }
  // Nothing set up at all is not "sent": the supervisor tries again (and logs it) until a channel delivers it.
  return { sent: delivered(outcomes) && Object.values(outcomes).includes("sent"), outcomes };
}
