/**
 * Claude vision client (D-005) — one of two providers behind VisionClient;
 * selection happens in @/lib/ai/provider. Tests mock the interface.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { CrfField } from "@/lib/crf";
import type { VisionClient } from "@/lib/ai/types";
import {
  PROMPT_VERSION,
  extractPrompt,
  fetchImageAsBase64,
  parseModelJson,
  qualityPrompt,
} from "@/lib/ai/prompts";

export function createClaudeVisionClient(cfg: {
  apiKey: string;
  model: string;
}): VisionClient {
  const client = new Anthropic({ apiKey: cfg.apiKey });

  async function visionCall(imageUrl: string, prompt: string) {
    const { data, mediaType } = await fetchImageAsBase64(imageUrl);
    const msg = await client.messages.create({
      model: cfg.model,
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as "image/jpeg",
                data,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });
    const text = msg.content.find((b) => b.type === "text")?.text ?? "{}";
    return parseModelJson(text);
  }

  return {
    modelId: cfg.model,
    promptVersion: PROMPT_VERSION,
    assessQuality: (imageUrl: string) => visionCall(imageUrl, qualityPrompt()),
    extract: (imageUrl: string, fields: CrfField[]) =>
      visionCall(imageUrl, extractPrompt(fields)),
  };
}
