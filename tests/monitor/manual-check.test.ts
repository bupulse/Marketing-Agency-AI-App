import { describe, expect, it, vi } from "vitest";
import { clock, dispatchOutsideCheck, nextCheck } from "@/lib/monitor/manual-check";

describe("dispatchOutsideCheck: the outside check started by hand", () => {
  it("not set up without a valid repo and token, and nothing is called", async () => {
    const f = vi.fn();
    expect(await dispatchOutsideCheck({}, f)).toBe("not-set-up");
    expect(await dispatchOutsideCheck({ GITHUB_REPO: "not a repo", GITHUB_TOKEN: "t" }, f)).toBe("not-set-up");
    expect(f).not.toHaveBeenCalled();
  });

  it("dispatches uptime.yml on main; 204 is started, anything else failed", async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await dispatchOutsideCheck({ GITHUB_REPO: "owner/name", GITHUB_TOKEN: "tok" }, f)).toBe("started");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/owner/name/actions/workflows/uptime.yml/dispatches");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ ref: "main" });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(await dispatchOutsideCheck({ GITHUB_REPO: "owner/name", GITHUB_TOKEN: "tok" }, async () => new Response("no", { status: 403 }))).toBe("failed");
    expect(await dispatchOutsideCheck({ GITHUB_REPO: "owner/name", GITHUB_TOKEN: "tok" }, async () => Promise.reject(new Error("offline")))).toBe("failed");
  });
});

describe("nextCheck and clock", () => {
  const last = "2026-11-10T12:00:00.000Z";
  const t = (min: number, sec = 0) => new Date(last).getTime() + min * 60_000 + sec * 1000;
  it("counts down to 5 minutes after the last check", () => {
    expect(nextCheck(last, t(2, 19))).toEqual({ agoMinutes: 2, inSeconds: 161, lateMinutes: 0 });
    expect(nextCheck(last, t(5, 30))).toEqual({ agoMinutes: 5, inSeconds: 0, lateMinutes: 0 });
  });
  it("says how late once more than a minute past due", () => {
    expect(nextCheck(last, t(9))).toEqual({ agoMinutes: 9, inSeconds: 0, lateMinutes: 4 });
  });
  it("no check yet", () => {
    expect(nextCheck(null, t(1))).toEqual({ agoMinutes: null, inSeconds: 0, lateMinutes: 0 });
  });
  it("clock", () => {
    expect(clock(161)).toBe("2:41");
    expect(clock(5)).toBe("0:05");
    expect(clock(-3)).toBe("0:00");
  });
});
