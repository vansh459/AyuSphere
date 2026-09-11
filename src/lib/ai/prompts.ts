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

export async function fetchImageAsBase64(
  url: string,
): Promise<{ data: string; mediaType: string }> {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const mediaType = res.headers.get("content-type") ?? "image/jpeg";
  return { data: buf.toString("base64"), mediaType };
}
