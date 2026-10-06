import "server-only";
import { GoogleGenAI } from "@google/genai";
import { AIProviderError, type TextProvider, type TextRequest, type TextResult } from "./types";

export class GeminiTextProvider implements TextProvider {
  readonly name = "gemini";
  private ai: GoogleGenAI;

  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generate({ system, prompt, jsonSchema }: TextRequest): Promise<TextResult> {
    let text: string | undefined;
    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          systemInstruction: system,
          ...(jsonSchema
            ? { responseMimeType: "application/json", responseJsonSchema: jsonSchema }
            : {}),
        },
      });
      text = response.text;
    } catch (error) {
      const status = (error as { status?: number }).status;
      throw new AIProviderError(
        `Gemini request failed${status ? ` (${status})` : ""}`,
        this.name,
        status === 429 || (status !== undefined && status >= 500),
      );
    }
    if (!text) throw new AIProviderError("Gemini returned no text", this.name);
    return { text, provider: this.name, model: this.model };
  }
}
