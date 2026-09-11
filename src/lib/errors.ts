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
  if (e instanceof Error) {
    // drizzle embeds the failing SQL in its message — never show that
    if (e.name === "DrizzleQueryError" || e.message.startsWith("Failed query:")) {
      const cause = (e as { cause?: Error & { code?: string } }).cause;
      if (cause?.code === "23505") {
        return "That record already exists — this combination must be unique.";
      }
      if (cause?.code === "23503") {
        return "That change conflicts with related records and was not saved.";
      }
      return "Database error — the change was not saved. Please retry.";
    }
    return e.message;
  }
  return "The action failed.";
}

/** encode an error for the ?error= banner redirect pattern */
export function withError(path: string, e: unknown): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}error=${encodeURIComponent(errorMessage(e))}`;
}
