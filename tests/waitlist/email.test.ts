import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/site-url", () => ({ publicSiteUrl: () => "https://bupulse.com" }));
const sendEmail = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail }));

import { sendWaitlistThankYou, waitlistThankYou, WAITLIST_REPLY_TO } from "@/lib/waitlist-email";
import { waitlistInfo } from "@/lib/waitlist";

const info = waitlistInfo(true, "2026-12-15")!;

describe("waiting-list thank-you email", () => {
  it("thanks the person by first name and gives the launch day and next steps", () => {
    const e = waitlistThankYou("Aline", info);
    expect(e.subject).toBe("You're on the list: BuPulse launches 15 December");
    expect(e.text).toContain("Hi Aline, thank you for joining the BuPulse waiting list");
    expect(e.text).toContain("reviewing your application");
    expect(e.text).toContain("we launch on 15 December");
    expect(e.text).toContain("will call you");
    expect(e.text).toContain("This Christmas ends with your own AI marketing team");
    expect(e.html).toContain("https://bupulse.com");
  });

  it("works without a name", () => {
    expect(waitlistThankYou(null, info).text).toContain("Thank you for joining");
  });

  it("is sent with replies going to hello@", async () => {
    expect(await sendWaitlistThankYou("person@example.com", "Aline", info)).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "person@example.com", replyTo: WAITLIST_REPLY_TO }));
  });
});
