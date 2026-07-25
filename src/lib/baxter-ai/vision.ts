import "server-only";

import { getEnv } from "@/lib/env";

export type ImageAnalysisResult = {
  description: string;
  extractedText: string;
  importantFacts: string[];
  entities: string[];
  documentType: string;
  warnings: string[];
};

export interface BaxterVisionProvider {
  readonly key: string;
  readonly name: string;
  readonly model: string;
  analyzeImage(input: {
    mimeType: string;
    base64Data: string;
    filename?: string;
  }): Promise<ImageAnalysisResult>;
}

const EMPTY_ANALYSIS: ImageAnalysisResult = {
  description: "",
  extractedText: "",
  importantFacts: [],
  entities: [],
  documentType: "unknown",
  warnings: [],
};

function shouldMockVision(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

/**
 * Mock vision for unit tests — never invents business facts beyond filename hints.
 */
export class MockBaxterVisionProvider implements BaxterVisionProvider {
  readonly key = "mock";
  readonly name = "Mock Vision";
  readonly model = "mock-vision";

  async analyzeImage(input: {
    mimeType: string;
    base64Data: string;
    filename?: string;
  }): Promise<ImageAnalysisResult> {
    const name = input.filename ?? "image";
    // Optional test hook: if base64 is UTF-8 JSON prefixed in tests
    if (input.base64Data.startsWith("eyJ")) {
      try {
        const parsed = JSON.parse(
          Buffer.from(input.base64Data, "base64").toString("utf8"),
        ) as Partial<ImageAnalysisResult>;
        return {
          description: parsed.description ?? `Image: ${name}`,
          extractedText: parsed.extractedText ?? "",
          importantFacts: parsed.importantFacts ?? [],
          entities: parsed.entities ?? [],
          documentType: parsed.documentType ?? "diagram",
          warnings: parsed.warnings ?? [],
        };
      } catch {
        // fall through
      }
    }
    return {
      description: `Image file ${name} (${input.mimeType}). Vision analysis unavailable in mock mode.`,
      extractedText: "",
      importantFacts: [],
      entities: [],
      documentType: "image",
      warnings: ["Mock vision provider — no OCR performed."],
    };
  }
}

export class OpenAIBaxterVisionProvider implements BaxterVisionProvider {
  readonly key = "openai";
  readonly name = "OpenAI Vision";
  readonly model: string;

  constructor(model?: string) {
    try {
      const env = getEnv();
      this.model = (
        model ||
        env.BAXTER_VISION_MODEL ||
        env.BAXTER_OPENAI_MODEL ||
        env.OPENAI_MODEL ||
        "gpt-4o-mini"
      ).trim();
    } catch {
      this.model = model || "gpt-4o-mini";
    }
  }

  async analyzeImage(input: {
    mimeType: string;
    base64Data: string;
    filename?: string;
  }): Promise<ImageAnalysisResult> {
    const env = getEnv();
    const apiKey = (env.OPENAI_API_KEY ?? "").trim();
    if (!apiKey) {
      return {
        ...EMPTY_ANALYSIS,
        warnings: ["OPENAI_API_KEY missing — image not analyzed."],
        documentType: "image",
        description: `Unanalyzed image: ${input.filename ?? "file"}`,
      };
    }

    const prompt = `Analyze this business document image carefully. Return ONLY valid JSON with keys:
description (string), extractedText (string of visible text, empty if none), importantFacts (string[]), entities (string[]), documentType (string), warnings (string[]).
Be conservative. Do not invent unreadable text or measurements. If text is unclear, say so in warnings.`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.EXTERNAL_API_TIMEOUT_MS);
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: 1200,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${input.mimeType};base64,${input.base64Data}`,
                  },
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };
      if (!response.ok) {
        return {
          ...EMPTY_ANALYSIS,
          warnings: [data.error?.message || `Vision failed (${response.status})`],
          description: `Image analysis failed for ${input.filename ?? "file"}`,
          documentType: "image",
        };
      }
      const content = data.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(content) as Partial<ImageAnalysisResult>;
      return {
        description: String(parsed.description ?? ""),
        extractedText: String(parsed.extractedText ?? ""),
        importantFacts: Array.isArray(parsed.importantFacts)
          ? parsed.importantFacts.map(String)
          : [],
        entities: Array.isArray(parsed.entities) ? parsed.entities.map(String) : [],
        documentType: String(parsed.documentType ?? "image"),
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
      };
    } catch (error) {
      return {
        ...EMPTY_ANALYSIS,
        warnings: [error instanceof Error ? error.message : "Vision analysis failed"],
        description: `Image analysis error for ${input.filename ?? "file"}`,
        documentType: "image",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

let visionOverride: BaxterVisionProvider | null = null;

export function setBaxterVisionProviderForTests(provider: BaxterVisionProvider | null) {
  visionOverride = provider;
}

export function getBaxterVisionProvider(): BaxterVisionProvider {
  if (visionOverride) return visionOverride;
  if (shouldMockVision()) return new MockBaxterVisionProvider();
  try {
    const env = getEnv();
    const provider = (env.BAXTER_VISION_PROVIDER || "openai").toLowerCase().trim();
    if (provider === "openai") return new OpenAIBaxterVisionProvider();
    if (provider === "mock") return new MockBaxterVisionProvider();
  } catch {
    return new MockBaxterVisionProvider();
  }
  return new OpenAIBaxterVisionProvider();
}
