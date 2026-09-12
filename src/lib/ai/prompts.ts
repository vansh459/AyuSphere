/** Shared prompts for Doctor Note Intelligence — provider-agnostic. */
import type { CrfField } from "@/lib/crf";

export const PROMPT_VERSION = "extract-v1";

export function qualityPrompt(): string {
  return `Assess this clinical-note photo for OCR readability. Respond with ONLY JSON:
{"score": <0..1>, "issues": [<any of "blur","glare","skew","cropped","low_light","unreadable">]}`;
}

export function extractPrompt(fields: CrfField[]): string {
  const fieldSpec = fields
    .map(
      (f) =>
        `- ${f.name} (${f.type}${f.unit ? `, ${f.unit}` : ""}${
          f.min !== undefined ? `, plausible ${f.min}–${f.max}` : ""
        }): ${f.label}`,
    )
    .join("\n");
  return `You are reading a handwritten/printed Ayurveda clinical-trial note.
Extract ONLY these CRF fields (protocol-aware extraction — ignore everything else):
${fieldSpec}

Respond with ONLY JSON, one entry per field you can read:
{"fields": {"<name>": {"value": <number or string>, "confidence": <0..1>, "sourceText": "<verbatim snippet>"}}}
Omit fields you cannot read. Never guess values.`;
}

/**
 * Parse a model's JSON reply robustly. Models (Gemini especially) sometimes
 * wrap JSON in ```json fences or prepend prose even when asked for JSON only.
 * Zod still gates the parsed value downstream (D-012) — this only rescues
 * the serialization, never the shape.
 */
export function parseModelJson(text: string): unknown {
  const raw = text.trim();
  try {
    return JSON.parse(raw);
  } catch {
    // 1) markdown-fenced block
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        // fall through to brace extraction
      }
    }
    // 2) first {...} block in surrounding prose
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        // fall through to the readable error
      }
    }
    throw new Error(
      `model returned non-JSON output: "${raw.slice(0, 120)}${raw.length > 120 ? "…" : ""}"`,
    );
  }
}

export async function fetchImageAsBase64(
  url: string,
): Promise<{ data: string; mediaType: string }> {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const mediaType = res.headers.get("content-type") ?? "image/jpeg";
  return { data: buf.toString("base64"), mediaType };
}
