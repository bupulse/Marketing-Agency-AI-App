import { describe, expect, it } from "vitest";
import { generateMarketingContent } from "@/lib/ai/marketing";
import { AIProviderError, type TextProvider } from "@/lib/ai/types";

const brand = { businessName: "Sunrise Bakery", industry: "Food", tone: "warm" };
const input = { type: "product", title: "Sourdough loaf", price: "$8", features: ["slow fermented"] };

function fakeProvider(text: string): TextProvider & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    name: "fake",
    prompts,
    async generate(request) {
      prompts.push(request.prompt);
      return { text, provider: "fake", model: "fake-1" };
    },
  };
}

describe("generateMarketingContent", () => {
  it("normalises hashtags and keeps at most three headlines", async () => {
    const provider = fakeProvider(
      JSON.stringify({
        caption: "Fresh bread daily.",
        hashtags: ["bakery", "#sourdough"],
        videoScript: "0-5s: oven",
        adHeadlines: ["a", "b", "c", "d"],
      }),
    );
    const { content, provider: name, model } = await generateMarketingContent(provider, brand, input);
    expect(content.hashtags).toEqual(["#bakery", "#sourdough"]);
    expect(content.adHeadlines).toEqual(["a", "b", "c"]);
    expect(name).toBe("fake");
    expect(model).toBe("fake-1");
  });

  it("puts the brand and promotion details in the prompt", async () => {
    const provider = fakeProvider(
      JSON.stringify({ caption: "c", hashtags: [], videoScript: "s", adHeadlines: ["h"] }),
    );
    await generateMarketingContent(provider, brand, input);
    expect(provider.prompts[0]).toContain("Business: Sunrise Bakery");
    expect(provider.prompts[0]).toContain("Price or offer: $8");
    expect(provider.prompts[0]).toContain("- slow fermented");
  });

  it("throws a retryable AIProviderError for non-JSON output", async () => {
    const error = await generateMarketingContent(fakeProvider("not json"), brand, input).catch((e) => e);
    expect(error).toBeInstanceOf(AIProviderError);
    expect(error.retryable).toBe(true);
  });

  it("throws when required fields are missing", async () => {
    const provider = fakeProvider(JSON.stringify({ caption: "only a caption" }));
    await expect(generateMarketingContent(provider, brand, input)).rejects.toBeInstanceOf(AIProviderError);
  });
});
