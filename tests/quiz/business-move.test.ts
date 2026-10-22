import { describe, expect, it } from "vitest";
import { moveGuard } from "@/lib/knowledge/quiz-move";

describe("moveGuard", () => {
  it("refuses a move made for a question that is no longer on screen (a late tile timer)", () => {
    const g = moveGuard();
    expect(g.begin("sell.item.passion juice", "customers.age")).toBe(false);
    expect(g.begin("customers.age", "customers.age")).toBe(true);
  });

  it("refuses a second move while one is saving", () => {
    const g = moveGuard();
    expect(g.begin("sell.item.passion juice", "sell.item.passion juice")).toBe(true);
    expect(g.moving).toBe(true);
    expect(g.begin("sell.item.passion juice", "sell.item.passion juice")).toBe(false);
    g.end(false); // the save failed: the owner may try again
    expect(g.begin("sell.item.passion juice", "sell.item.passion juice")).toBe(true);
  });

  it("refuses Enter and the button's click in one tick, until the next question shows", () => {
    const g = moveGuard();
    expect(g.begin("you.size", "you.size")).toBe(true);
    g.end(true);
    expect(g.begin("you.size", "you.size")).toBe(false); // the screen has not caught up yet
    g.seen("you.year");
    g.seen("you.size"); // Back
    expect(g.begin("you.size", "you.size")).toBe(true);
  });

  it("after a save, moves on only if the quiz is still on the same question", () => {
    const g = moveGuard();
    expect(g.stillOn("rules.faqs", "rules.faqs")).toBe(true);
    expect(g.stillOn("rules.faqs", "voice.tone")).toBe(false);
  });
});
