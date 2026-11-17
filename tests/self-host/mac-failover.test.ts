import { describe, expect, it } from "vitest";
import { decide, servingOf, TARGET, TIMING } from "../../scripts/self-host/mac-failover/watch.mjs";

const pc = { serving: "pc", pcBadSince: null, pcGoodSince: null };
const min = 60_000;

describe("mac failover watcher", () => {
  it("switches to the Mac only after the PC has been silent for 5 minutes and the Mac answers", () => {
    let s = decide(pc, { pcOk: false, macOk: true, now: 0 });
    expect(s.switchTo).toBeNull();
    s = decide(s.state, { pcOk: false, macOk: true, now: 4 * min });
    expect(s.switchTo).toBeNull();
    s = decide(s.state, { pcOk: false, macOk: true, now: TIMING.failAfterMs });
    expect(s.switchTo).toBe("mac");
    expect(s.state.serving).toBe("mac");
  });

  it("starts the count again when the PC answers once", () => {
    let s = decide(pc, { pcOk: false, macOk: true, now: 0 });
    s = decide(s.state, { pcOk: true, macOk: true, now: 3 * min });
    s = decide(s.state, { pcOk: false, macOk: true, now: 4 * min });
    s = decide(s.state, { pcOk: false, macOk: true, now: 8 * min });
    expect(s.switchTo).toBeNull();
    expect(decide(s.state, { pcOk: false, macOk: true, now: 9 * min }).switchTo).toBe("mac");
  });

  it("never switches when the Mac does not answer either (a database outage)", () => {
    let s = decide(pc, { pcOk: false, macOk: false, now: 0 });
    s = decide(s.state, { pcOk: false, macOk: false, now: 60 * min });
    expect(s.switchTo).toBeNull();
    expect(s.state.serving).toBe("pc");
  });

  it("switches back after the PC has answered for 60 minutes in a row", () => {
    const mac = { serving: "mac", pcBadSince: null, pcGoodSince: null };
    let s = decide(mac, { pcOk: true, macOk: true, now: 0 });
    s = decide(s.state, { pcOk: false, macOk: true, now: 5 * min });
    s = decide(s.state, { pcOk: true, macOk: true, now: 6 * min });
    s = decide(s.state, { pcOk: true, macOk: true, now: 60 * min });
    expect(s.switchTo).toBeNull();
    s = decide(s.state, { pcOk: true, macOk: true, now: 6 * min + TIMING.recoverAfterMs });
    expect(s.switchTo).toBe("pc");
  });

  it("doubles the wait when the PC fails again soon after getting the site back, up to 8 hours", () => {
    let s = decide({ serving: "mac", pcBadSince: null, pcGoodSince: null }, { pcOk: true, macOk: true, now: 0 });
    s = decide(s.state, { pcOk: true, macOk: true, now: 60 * min });
    expect(s.switchTo).toBe("pc");
    s = decide(s.state, { pcOk: false, macOk: true, now: 62 * min });
    s = decide(s.state, { pcOk: false, macOk: true, now: 67 * min });
    expect(s.switchTo).toBe("mac");
    expect(s.state.recoverMs).toBe(120 * min);
    // A failure long after going back starts again from 60 minutes.
    const later = decide({ serving: "pc", pcBadSince: null, pcGoodSince: null, recoverMs: 240 * min, backAt: 0 }, { pcOk: false, macOk: true, now: 10 * 60 * min });
    const switched = decide(later.state, { pcOk: false, macOk: true, now: 10 * 60 * min + 5 * min });
    expect(switched.state.recoverMs).toBe(TIMING.recoverAfterMs);
    const capped = decide({ serving: "pc", pcBadSince: 0, pcGoodSince: null, recoverMs: 8 * 60 * min, backAt: 0 }, { pcOk: false, macOk: true, now: 5 * min });
    expect(capped.state.recoverMs).toBe(TIMING.maxRecoverMs);
  });

  it("reads which side the DNS points at", () => {
    expect(servingOf(TARGET.pc)).toBe("pc");
    expect(servingOf(TARGET.mac)).toBe("mac");
    expect(servingOf("example.netlify.app")).toBeNull();
  });
});
