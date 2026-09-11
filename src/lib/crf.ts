/**
 * CRF template → runtime validation (D-012).
 * Templates store their field rules as data (jsonb); this factory compiles
 * them to Zod so manual entry AND AI extraction pass through identical
 * validation — AI output can never bypass it.
 */
import { z } from "zod";

export const crfFieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["number", "text", "date", "select"]),
  unit: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  required: z.boolean(),
  cdashVar: z.string().min(1),
  options: z.array(z.string()).optional(),
});

export type CrfField = z.infer<typeof crfFieldSchema>;

export function parseTemplateFields(raw: unknown): CrfField[] {
  return z.array(crfFieldSchema).parse(raw);
}

function fieldToZod(f: CrfField): z.ZodTypeAny {
  switch (f.type) {
    case "number": {
      let s = z.number({ message: `${f.label} must be a number` });
      if (f.min !== undefined)
        s = s.min(f.min, `${f.label} below plausible range (${f.min}${f.unit ?? ""})`);
      if (f.max !== undefined)
        s = s.max(f.max, `${f.label} above plausible range (${f.max}${f.unit ?? ""})`);
      return s;
    }
    case "date":
      return z.iso.date(`${f.label} must be an ISO date`);
    case "select":
      return f.options && f.options.length > 0
        ? z.enum(f.options as [string, ...string[]])
        : z.string();
    case "text":
      return z.string();
  }
}

/**
 * mode "draft": provided values must be valid, but required fields may be
 * absent. mode "submit": required fields must all be present and valid.
 */
export function buildCrfSchema(
  fields: CrfField[],
  mode: "draft" | "submit",
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    const base = fieldToZod(f);
    shape[f.name] =
      mode === "submit" && f.required ? base : base.optional();
  }
  return z.strictObject(shape);
}

export type CrfValidationResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; issues: { field: string; message: string }[] };

export function validateCrfData(
  fields: CrfField[],
  data: unknown,
  mode: "draft" | "submit",
): CrfValidationResult {
  const res = buildCrfSchema(fields, mode).safeParse(data);
  if (res.success) return { ok: true, data: res.data };
  return {
    ok: false,
    issues: res.error.issues.map((i) => ({
      field: i.path.join(".") || "(form)",
      message: i.message,
    })),
  };
}
