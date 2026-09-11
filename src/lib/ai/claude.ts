/**
 * Real Claude vision client (D-005). Exercised at runtime via
 * /api/ai/extract; tests use a mock against the same interface.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { CrfField } from "@/lib/crf";
import type { VisionClient } from "@/lib/ai/types";

const PROMPT_VERSION = "extract-v1";

function getModel() {
  return process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
}

async function fetchImageAsBase64(url: string) {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const mediaType = res.headers.get("content-type") ?? "image/jpeg";
  return { data: buf.toString("base64"), mediaType };
}

export function createClaudeVisionClient(): VisionClient {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  return {
    modelId: getModel(),
    promptVersion: PROMPT_VERSION,

    async assessQuality(imageUrl: string) {
      const { data, mediaType } = await fetchImageAsBase64(imageUrl);
      const msg = await client.messages.create({
        model: getModel(),
        max_tokens: 300,
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
              {
                type: "text",
                text: `Assess this clinical-note photo for OCR readability. Respond with ONLY JSON:
{"score": <0..1>, "issues": [<any of "blur","glare","skew","cropped","low_light","unreadable">]}`,
              },
            ],
          },
        ],
      });
      const text = msg.content.find((b) => b.type === "text")?.text ?? "{}";
      return JSON.parse(text);
    },

    async extract(imageUrl: string, fields: CrfField[]) {
      const { data, mediaType } = await fetchImageAsBase64(imageUrl);
      const fieldSpec = fields
        .map(
          (f) =>
            `- ${f.name} (${f.type}${f.unit ? `, ${f.unit}` : ""}${
              f.min !== undefined ? `, plausible ${f.min}–${f.max}` : ""
            }): ${f.label}`,
        )
        .join("\n");
      const msg = await client.messages.create({
        model: getModel(),
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
              {
                type: "text",
                text: `You are reading a handwritten/printed Ayurveda clinical-trial note.
Extract ONLY these CRF fields (protocol-aware extraction — ignore everything else):
${fieldSpec}

Respond with ONLY JSON, one entry per field you can read:
{"fields": {"<name>": {"value": <number or string>, "confidence": <0..1>, "sourceText": "<verbatim snippet>"}}}
Omit fields you cannot read. Never guess values.`,
              },
            ],
          },
        ],
      });
      const text = msg.content.find((b) => b.type === "text")?.text ?? "{}";
      return JSON.parse(text);
    },
  };
}
