import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`redirect:${u}`); }, notFound: () => { throw new Error("404"); } }));
vi.mock("@/lib/admin/auth", () => ({ requireAdmin: async () => ({ id: "u", email: "a@b.c" }) }));
vi.mock("@/lib/admin/service", () => ({ APPROVAL_TTL_MS: 1 }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/errors", () => ({ logError: async () => {} }));

import { finish, safeAdminUrl, userIdOf } from "@/lib/admin/console";
import { currencyDigits, money, toMinor } from "@/lib/admin/format";

const redirected = async (back: string) => {
  try {
    await finish(back, "ok", async () => {});
  } catch (e) {
    return String((e as Error).message).replace("redirect:", "");
  }
};

describe("redirect target after a console action", () => {
  it("keeps real admin paths with their query and hash", () => {
    expect(safeAdminUrl("/admin/users/abc?x=1#top").pathname).toBe("/admin/users/abc");
    expect(safeAdminUrl("/admin").pathname).toBe("/admin");
  });

  it.each(["/admin/..//evil.com", "//evil.com", "https://evil.com/admin", "/administrator", "/dashboard", "/admin/%2e%2e//evil.com", "javascript:alert(1)", ""])(
    "turns %j into /admin",
    (back) => {
      expect(safeAdminUrl(back).pathname).toBe("/admin");
    },
  );

  it("never produces a protocol-relative redirect", async () => {
    const target = await redirected("/admin/..//evil.com");
    expect(target?.startsWith("/admin")).toBe(true);
    expect(target?.startsWith("//")).toBe(false);
  });
});

describe("user ids", () => {
  it("accepts a uuid and refuses anything else", () => {
    expect(userIdOf("0E2A8F55-1C57-4C5E-9B4A-7A0D2C0D6F11")).toBe("0e2a8f55-1c57-4c5e-9b4a-7a0d2c0d6f11");
    expect(() => userIdOf("../../x")).toThrow();
    expect(() => userIdOf("")).toThrow();
  });
});

describe("money in the payment's own currency", () => {
  it("formats USD, EUR and zero-decimal currencies", () => {
    expect(money(1000)).toBe("$10.00");
    expect(money(1000, "EUR")).toBe("€10.00");
    expect(money(1000, "JPY")).toBe("¥1,000");
    expect(currencyDigits("JPY")).toBe(0);
  });
  it("turns typed amounts into the smallest unit", () => {
    expect(toMinor("12.50")).toBe(1250);
    expect(toMinor("$1,200")).toBe(120000);
    expect(toMinor("500", "JPY")).toBe(500);
    expect(toMinor("abc")).toBeNull();
    expect(toMinor("-5")).toBeNull();
  });
});
