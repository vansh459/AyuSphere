/**
 * Gemini client — implements the same VisionClient/TextClient interfaces as
 * the Claude client, via the Generative Language REST API (no SDK needed).
 * All outputs still pass through the Zod gates in the service layer (D-012).
 */
import type { CrfField } from "@/lib/crf";
import type { VisionClient } from "@/lib/ai/types";
import type { TextClient } from "@/services/copilot";
import {
  PROMPT_VERSION,
  extractPrompt,
  fetchImageAsBase64,
  parseModelJson,
  qualityPrompt,
} from "@/lib/ai/prompts";

export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

async function geminiGenerate(
  cfg: { apiKey: string; model: string },
  parts: GeminiPart[],
  jsonOutput: boolean,
): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": cfg.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: jsonOutput
          ? { responseMimeType: "application/json" }
          : {},
      }),
    },
  );
  const data = (await res.json()) as {
    error?: { message?: string };
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Gemini request failed (${res.status})`);
  }
  return (
    data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("") ?? ""
  );
}

export function createGeminiVisionClient(cfg: {
  apiKey: string;
  model: string;
}): VisionClient {
  return {
    modelId: cfg.model,
    promptVersion: PROMPT_VERSION,

    async assessQuality(imageUrl: string) {
      const { data, mediaType } = await fetchImageAsBase64(imageUrl);
      const text = await geminiGenerate(
        cfg,
        [
          { inline_data: { mime_type: mediaType, data } },
          { text: qualityPrompt() },
        ],
        true,
      );
      return parseModelJson(text);
    },

    async extract(imageUrl: string, fields: CrfField[]) {
      const { data, mediaType } = await fetchImageAsBase64(imageUrl);
      const text = await geminiGenerate(
        cfg,
        [
          { inline_data: { mime_type: mediaType, data } },
          { text: extractPrompt(fields) },
        ],
        true,
      );
      return parseModelJson(text);
    },
  };
}

export function createGeminiTextClient(cfg: {
  apiKey: string;
  model: string;
}): TextClient {
  return {
    modelId: cfg.model,
    async complete(prompt: string) {
      return geminiGenerate(cfg, [{ text: prompt }], false);
    },
  };
}
