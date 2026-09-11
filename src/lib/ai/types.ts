/**
 * AI contracts for Doctor Note Intelligence (D-005).
 * The service layer depends on this interface — the real Claude client and
 * the test mock both implement it, and every output is parsed through Zod
 * before it can influence anything (D-012).
 */
import { z } from "zod";
import type { CrfField } from "@/lib/crf";

export const imageQualitySchema = z.object({
  /** 0 (unreadable) … 1 (perfect) */
  score: z.number().min(0).max(1),
  issues: z.array(
    z.enum(["blur", "glare", "skew", "cropped", "low_light", "unreadable"]),
  ),
});

export type ImageQuality = z.infer<typeof imageQualitySchema>;

export const extractedFieldSchema = z.object({
  value: z.union([z.string(), z.number()]),
  /** model's own confidence, 0…1 */
  confidence: z.number().min(0).max(1),
  /** the source text in the note this value came from */
  sourceText: z.string().optional(),
});

export const extractionOutputSchema = z.object({
  fields: z.record(z.string(), extractedFieldSchema),
});

export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;

export interface VisionClient {
  readonly modelId: string;
  readonly promptVersion: string;
  /** step 2 — image quality pre-pass */
  assessQuality(imageUrl: string): Promise<unknown>;
  /** steps 3–5 — OCR + entity extraction + mapping to the visit's template */
  extract(imageUrl: string, fields: CrfField[]): Promise<unknown>;
}
