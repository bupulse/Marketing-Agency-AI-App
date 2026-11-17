import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/monitor/alerts", () => ({ sendOwnerAlert: vi.fn() }));

import { parsePcAlert, pcAlertText, type PcAlert } from "@/lib/monitor/pc-alert-rules";
import { sendPcAlert } from "@/lib/monitor/pc-alert";

const miner = { name: "dlIhost", path: "C:\\Users\\WECPC015\\AppData\\Roaming\\DLL\\dlIhost.exe", pid: 4242, memMb: 2406, looksLike: "dllhost", reasons: ["lookalike", "dll-path", "memory"] };

describe("parsePcAlert", () => {
  it("takes the supervisor's report", () => {
    const r = parsePcAlert({ kind: "suspicious-process", findings: [miner, { name: "DLL folder", path: "C:\\x\\DLL", pid: null, memMb: null, looksLike: null, reasons: ["dll-folder"] }] });
    expect(r.ok && r.value.findings).toEqual([miner, { name: "DLL folder", path: "C:\\x\\DLL", pid: null, memMb: null, looksLike: null, reasons: ["dll-folder"] }]);
  });

  it("drops unknown reasons and bad findings, caps the list, refuses the rest", () => {
    const r = parsePcAlert({ kind: "suspicious-process", findings: [{ ...miner, reasons: ["lookalike", "rm -rf"] }, { name: "x", reasons: [] }, ...Array(20).fill(miner)] });
    expect(r.ok && r.value.findings[0].reasons).toEqual(["lookalike"]);
    expect(r.ok && r.value.findings.length).toBe(9);
    expect(parsePcAlert({ kind: "other", findings: [miner] }).ok).toBe(false);
    expect(parsePcAlert({ kind: "suspicious-process", findings: [] }).ok).toBe(false);
    expect(parsePcAlert([]).ok).toBe(false);
  });
});

describe("the owner's message", () => {
  it("names the program, why, and what to do", () => {
    const t = pcAlertText({ kind: "suspicious-process", findings: [miner] } as PcAlert);
    expect(t.subject).toBe("Warning: possible crypto-miner on the server PC (dlIhost)");
    expect(t.line).toContain('found "dlIhost": its name imitates the Windows program "dllhost"; it runs from AppData\\Roaming\\DLL');
    expect(t.line).toContain("2.3 GB");
    expect(t.blocks[0]).toEqual({ label: "dlIhost (PID 4242)", value: expect.stringContaining(miner.path) });
  });

  it("sent only when a channel delivered it", async () => {
    const alert = { kind: "suspicious-process", findings: [miner] } as PcAlert;
    expect((await sendPcAlert(alert, { send: async () => ({ email: "sent", telegram: "failed" }) })).sent).toBe(true);
    expect((await sendPcAlert(alert, { send: async () => ({ email: "skipped", telegram: "skipped" }) })).sent).toBe(false);
    expect((await sendPcAlert(alert, { send: async () => Promise.reject(new Error("down")) })).sent).toBe(false);
  });
});

describe("pc-alert route", () => {
  const sendPcAlertMock = vi.fn();
  beforeEach(() => {
    vi.resetModules();
    sendPcAlertMock.mockReset();
    sendPcAlertMock.mockResolvedValue({ sent: true, outcomes: { email: "sent", telegram: "sent" } });
    vi.doMock("@/lib/monitor/pc-alert", () => ({ sendPcAlert: sendPcAlertMock }));
    process.env.CRON_SECRET = "pc-secret";
  });
  const post = (auth: string | null, body: unknown) =>
    new NextRequest("http://127.0.0.1:3002/api/monitor/pc-alert", { method: "POST", headers: { ...(auth ? { authorization: auth } : {}), "content-type": "application/json" }, body: JSON.stringify(body) });

  it("only the PC's secret may post", async () => {
    const { POST } = await import("@/app/api/monitor/pc-alert/route");
    expect((await POST(post(null, { kind: "suspicious-process", findings: [miner] }))).status).toBe(401);
    expect((await POST(post("Bearer wrong", { kind: "suspicious-process", findings: [miner] }))).status).toBe(401);
    expect(sendPcAlertMock).not.toHaveBeenCalled();
    const ok = await POST(post("Bearer pc-secret", { kind: "suspicious-process", findings: [miner] }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, sent: true });
    expect(sendPcAlertMock).toHaveBeenCalledWith({ kind: "suspicious-process", findings: [miner] });
  });

  it("refuses a bad body", async () => {
    const { POST } = await import("@/app/api/monitor/pc-alert/route");
    expect((await POST(post("Bearer pc-secret", { kind: "suspicious-process", findings: "dlIhost" }))).status).toBe(400);
    expect(sendPcAlertMock).not.toHaveBeenCalled();
  });
});
