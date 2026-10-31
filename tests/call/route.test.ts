import { describe, expect, it } from "vitest";
import { GET } from "@/app/call/[phone]/route";

const call = (phone: string) => GET(new Request(`https://test.bupulse.com/call/${phone}`), { params: Promise.resolve({ phone }) } as never);

describe("/call/<number>", () => {
  it("hands a phone number to the dialer", async () => {
    const res = await call("250788000001");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('content="0; url=tel:+250788000001"');
    expect(html).toContain('href="tel:+250788000001"');
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
  });

  it("refuses anything that is not a phone number", async () => {
    for (const bad of ["abc", "123", "2507880000011234567", "250788000001%22%3E"]) expect((await call(bad)).status).toBe(404);
  });
});
