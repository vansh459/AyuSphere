/**
 * Date formatting — single source of truth (T6.7).
 * Server components render on Vercel where TZ=UTC, so a bare
 * `toLocaleDateString()` shows the UTC date: a visit completed at 00:30 IST
 * renders as the PREVIOUS day. All user-facing dates are therefore pinned to
 * IST (AIIA's timezone; no DST, so output is deterministic on any server) —
 * which also keeps server and client renders identical (no hydration drift).
 * The design-qa suite forbids bare toLocale*String calls outside this file.
 */

export const APP_TZ = "Asia/Kolkata";
export const APP_LOCALE = "en-IN";

/** "14/09/2026" — date only, IST */
export function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toLocaleDateString(APP_LOCALE, {
    timeZone: APP_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** "14/09/2026, 1:07 am" — date + wall-clock time, IST */
export function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toLocaleString(APP_LOCALE, {
    timeZone: APP_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "1:07:03 am" — time only, IST (header clock) */
export function fmtTime(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toLocaleTimeString(APP_LOCALE, { timeZone: APP_TZ });
}
