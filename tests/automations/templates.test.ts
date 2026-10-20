import { describe, expect, it } from "vitest";
import { TEMPLATES, templateByKey } from "@/lib/automations/templates";
import { graphProblems, triggerOf } from "@/lib/automations/graph";
import { parseCsv } from "@/lib/contacts/csv-parse";

describe("automation templates", () => {
  it("every template can be published as it is", () => {
    for (const t of TEMPLATES) expect(graphProblems(t.graph()), t.key).toEqual([]);
  });

  it("each template's channels match its trigger, and the comment ones are marked social", () => {
    for (const t of TEMPLATES) {
      const trigger = triggerOf(t.graph())!;
      expect(trigger.data.channels.sort(), t.key).toEqual([...t.channels].sort());
      expect(t.social, t.key).toBe(trigger.data.kind === "comment_keyword" || trigger.data.kind === "any_comment");
    }
  });

  it("gives a fresh copy each time (editing one never changes the template)", () => {
    const a = templateByKey("welcome_menu")!.graph();
    a.nodes[0].position.x = 999;
    expect(templateByKey("welcome_menu")!.graph().nodes[0].position.x).toBe(0);
    expect(templateByKey("nope")).toBeNull();
  });
});

describe("contacts CSV", () => {
  it("reads quotes, commas and new lines inside quotes", () => {
    expect(parseCsv('name,phone,tags\r\n"Uwase, Aline",0788123456,"VIP; Bought"\n"He said ""hi""",, \n')).toEqual([
      ["name", "phone", "tags"],
      ["Uwase, Aline", "0788123456", "VIP; Bought"],
      ['He said "hi"', "", " "],
    ]);
  });
});
