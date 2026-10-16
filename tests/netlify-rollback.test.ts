import { describe, expect, it } from "vitest";
import { previousDeploy } from "../scripts/netlify-rollback.mjs";

const d = (id: string, state = "ready", context = "production") => ({ id, state, context });

describe("Netlify rollback: which deploy to restore", () => {
  it("is the ready production deploy right before the live one", () => {
    expect(previousDeploy([d("c"), d("b"), d("a")], "c")).toEqual(d("b"));
  });

  it("skips failed and non-production deploys", () => {
    expect(previousDeploy([d("c"), d("x", "error"), d("p", "ready", "deploy-preview"), d("a")], "c")).toEqual(d("a"));
  });

  it("goes one further back after a rollback (the live deploy is an older one)", () => {
    expect(previousDeploy([d("c"), d("b"), d("a")], "b")).toEqual(d("a"));
  });

  it("is null when nothing older is ready or the live one is not listed", () => {
    expect(previousDeploy([d("c"), d("b", "error")], "c")).toBeNull();
    expect(previousDeploy([d("c")], "zzz")).toBeNull();
    expect(previousDeploy([], null)).toBeNull();
  });
});
