import { describe, expect, it } from "vitest";
import type { FeatureKey } from "@/lib/features";
import { homeChecklist } from "@/lib/home-checklist";

const base = { brandDone: true, connections: 0, products: 0, widgetInstalled: false };
const withChat = new Set<FeatureKey>(["content", "websiteChat"]);
const labels = (items: { label: string }[]) => items.map((i) => i.label);

describe("dashboard home checklist", () => {
  it("lists the chat widget only when the plan has website chat, and links it to Website chat", () => {
    expect(labels(homeChecklist({ ...base, role: "OWNER", inPlan: new Set(["content"]) }))).not.toContain("Install the chat widget");
    const widget = homeChecklist({ ...base, role: "OWNER", inPlan: withChat }).find((i) => i.label === "Install the chat widget");
    expect(widget).toEqual({ label: "Install the chat widget", done: false, href: "/dashboard/widget", ask: null });
  });

  it("marks the chat widget done once it is installed", () => {
    const items = homeChecklist({ ...base, widgetInstalled: true, role: "OWNER", inPlan: withChat });
    expect(items.find((i) => i.label === "Install the chat widget")?.done).toBe(true);
  });

  it("shows Members what only an owner or admin can do as read-only, with who to ask", () => {
    const items = homeChecklist({ ...base, role: "MEMBER", inPlan: withChat });
    const ask = Object.fromEntries(items.map((i) => [i.label, i.ask]));
    expect(ask).toEqual({
      "Complete your brand profile": "Ask your company owner or an admin to do this.",
      "Connect a social account": "Ask your company owner or an admin to do this.",
      "Add your first product or service": null,
      "Install the chat widget": "Ask your company owner or an admin to do this.",
    });
    expect(homeChecklist({ ...base, role: "ADMIN", inPlan: withChat }).every((i) => i.ask === null)).toBe(true);
  });

  it("sends the product item to the list once there is one", () => {
    expect(homeChecklist({ ...base, role: "MEMBER", inPlan: withChat })[2].href).toBe("/dashboard/knowledge/products/new");
    expect(homeChecklist({ ...base, products: 2, role: "MEMBER", inPlan: withChat })[2]).toMatchObject({ done: true, href: "/dashboard/knowledge/products" });
  });
});
