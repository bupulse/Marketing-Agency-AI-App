import { describe, expect, it } from "vitest";
import { downMinutes, fillLevel, seconds, share, speedLevel, uptimeLevel, windowMinutes } from "@/components/support-app/server/server-math";

describe("server page maths", () => {
  it("fill levels", () => {
    expect(fillLevel(null)).toBe("none");
    expect(fillLevel(0.5)).toBe("good");
    expect(fillLevel(0.85)).toBe("warn");
    expect(fillLevel(0.95)).toBe("bad");
    expect(fillLevel(0.9, 0.85, 0.95)).toBe("warn");
  });
  it("uptime and speed levels", () => {
    expect(uptimeLevel(99.95)).toBe("good");
    expect(uptimeLevel(99.5)).toBe("warn");
    expect(uptimeLevel(97)).toBe("bad");
    expect(uptimeLevel(null)).toBe("none");
    expect(speedLevel(640)).toBe("good");
    expect(speedLevel(1200)).toBe("warn");
    expect(speedLevel(3500)).toBe("bad");
  });
  it("minutes down behind a percentage, over the window monitoring covers", () => {
    expect(downMinutes(99.9, 30 * 1440)).toBe(43);
    expect(downMinutes(100, 1440)).toBe(0);
    expect(downMinutes(null, 1440)).toBeNull();
    const now = new Date("2026-11-10T12:00:00Z").getTime();
    expect(windowMinutes(now - 7 * 86_400_000, "2026-11-09T12:00:00Z", now)).toBe(1440);
    expect(windowMinutes(now - 60 * 60_000, null, now)).toBe(60);
  });
  it("bar shares and seconds", () => {
    expect(share(1500, 3000)).toBe(0.5);
    expect(share(9000, 3000)).toBe(1);
    expect(share(null, 3000)).toBe(0);
    expect(seconds(640)).toBe("640 ms");
    expect(seconds(1240)).toBe("1.2 s");
    expect(seconds(null)).toBe("–");
  });
});
