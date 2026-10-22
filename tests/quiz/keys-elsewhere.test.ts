import { afterEach, describe, expect, it, vi } from "vitest";
import { enterMeansNext, keysElsewhere } from "@/components/quiz/frame";

// Node test environment: a key event and the document are faked with just what the helpers read.
const key = (k: string, target: { tagName: string; type?: string; inDialog?: boolean }) =>
  ({ key: k, target: { tagName: target.tagName, type: target.type, isContentEditable: false, closest: () => (target.inDialog ? {} : null) } }) as unknown as KeyboardEvent;

function documentWithOpenDialog(open: boolean) {
  vi.stubGlobal("document", { querySelector: (s: string) => (open && s === "dialog[open]" ? {} : null) });
}

describe("quiz keys while a window is open over the question", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("Enter in a one-line answer field goes to the next question", () => {
    documentWithOpenDialog(false);
    expect(enterMeansNext(key("Enter", { tagName: "INPUT", type: "text" }))).toBe(true);
  });

  it("Enter in the 'Import from a link' field is the dialog's, not the quiz's", () => {
    documentWithOpenDialog(true);
    const e = key("Enter", { tagName: "INPUT", type: "url", inDialog: true });
    expect(keysElsewhere(e)).toBe(true);
    expect(enterMeansNext(e)).toBe(false);
  });

  it("any key is left alone while a modal dialog is open, wherever the focus is", () => {
    documentWithOpenDialog(true);
    expect(enterMeansNext(key("Enter", { tagName: "BODY" }))).toBe(false);
  });
});
