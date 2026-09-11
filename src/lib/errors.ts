/**
 * User-facing error formatting for server actions — pure module (no auth
 * imports) so it is unit-testable. Zod issues are rendered as readable
 * sentences; raw issue JSON must never reach an error banner.
 */
import { ZodError } from "zod";

const FIELD_LABELS: Record<string, string> = {
  protocolCode: "Protocol code",
  title: "Title",
  intervention: "Intervention",
  targetEnrollment: "Target enrolment",
  visitPlan: "Visit plan",
  enrollmentTarget: "Enrolment target",
  apiKey: "API key",
  email: "Email",
  password: "Password",
  name: "Name",
};

export function errorMessage(e: unknown): string {
  if (e instanceof ZodError) {
    return e.issues
      .map((i) => {
        const field = i.path.map(String).join(".");
        const label = FIELD_LABELS[field] ?? field;
        return `${label || "Form"}: ${i.message}`;
      })
      .join(" · ");
  }
  return e instanceof Error ? e.message : "The action failed.";
}

/** encode an error for the ?error= banner redirect pattern */
export function withError(path: string, e: unknown): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}error=${encodeURIComponent(errorMessage(e))}`;
}
