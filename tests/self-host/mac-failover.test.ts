import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without types
import { decide, servingOf, TARGET, TIMING } from "../../scripts/self-host/mac-failover/watch.mjs";

const pc = { serving: "pc", pcBadSince: null, pcGoodSince: null };
const min = 60_000;

describe("mac failover watcher", () => {
  it("switches to the Mac only after the PC has been silent for 10 minutes and the Mac answers", () => {
    let s = decide(pc, { pcOk: false, macOk: true, now: 0 });
    expect(s.switchTo).toBeNull();
    s = decide(s.state, { pcOk: false, macOk: true, now: 9 * min });
    expect(s.switchTo).toBeNull();
    s = decide(s.state, { pcOk: false, macOk: true, now: TIMING.failAfterMs });
    expect(s.switchTo).toBe("mac");
    expect(s.state.serving).toBe("mac");
  });

  it("starts the count again when the PC answers once", () => {
    let s = decide(pc, { pcOk: false, macOk: true, now: 0 });
    s = decide(s.state, { pcOk: true, macOk: true, now: 5 * min });
    s = decide(s.state, { pcOk: false, macOk: true, now: 6 * min });
    s = decide(s.state, { pcOk: false, macOk: true, now: 14 * min });
    expect(s.switchTo).toBeNull();
    expect(decide(s.state, { pcOk: false, macOk: true, now: 16 * min }).switchTo).toBe("mac");
  });

  it("never switches when the Mac does not answer either (a database outage)", () => {
    let s = decide(pc, { pcOk: false, macOk: false, now: 0 });
    s = decide(s.state, { pcOk: false, macOk: false, now: 60 * min });
    expect(s.switchTo).toBeNull();
    expect(s.state.serving).toBe("pc");
  });

  it("switches back after the PC has answered for 10 minutes in a row", () => {
    const mac = { serving: "mac", pcBadSince: null, pcGoodSince: null };
    let s = decide(mac, { pcOk: true, macOk: true, now: 0 });
    s = decide(s.state, { pcOk: false, macOk: true, now: 5 * min });
    s = decide(s.state, { pcOk: true, macOk: true, now: 6 * min });
    s = decide(s.state, { pcOk: true, macOk: true, now: 15 * min });
    expect(s.switchTo).toBeNull();
    s = decide(s.state, { pcOk: true, macOk: true, now: 6 * min + TIMING.recoverAfterMs });
    expect(s.switchTo).toBe("pc");
  });

  it("reads which side the DNS points at", () => {
    expect(servingOf(TARGET.pc)).toBe("pc");
    expect(servingOf(TARGET.mac)).toBe("mac");
    expect(servingOf("example.netlify.app")).toBeNull();
  });
});
