/**
 * Phone detection for the PWA install banner (T6.13) — pure functions over
 * an injectable snapshot so the rules are unit-testable. Screen width is
 * NEVER consulted: a desktop window resized narrow must not count as a phone.
 */

export type DeviceSnapshot = {
  userAgent: string;
  maxTouchPoints: number;
};

function fromNavigator(): DeviceSnapshot {
  if (typeof navigator === "undefined") return { userAgent: "", maxTouchPoints: 0 };
  return {
    userAgent: navigator.userAgent ?? "",
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  };
}

/**
 * Android PHONE only: Android UAs include "Mobile" on phones and omit it on
 * tablets — that word is the phone/tablet split, not the screen size.
 * ("Windows" guard: some Windows UAs mention Android app streaming.)
 */
export function isAndroidPhone(d: DeviceSnapshot = fromNavigator()): boolean {
  const ua = d.userAgent;
  return /Android/i.test(ua) && /Mobile/i.test(ua) && !/Windows/i.test(ua);
}

/**
 * iPhone only — iPads are EXCLUDED on purpose, twice over. Do not "simplify"
 * this away:
 *  - legacy iPads say "iPad" in the UA (never "iPhone"), so they fail the
 *    iPhone test naturally;
 *  - iPadOS 13+ masquerades as DESKTOP Safari ("Macintosh" UA, no iPad/iPhone
 *    token). The only reliable tiebreak vs a real Mac is touch:
 *    Macintosh UA + maxTouchPoints > 1 ⇒ an iPad pretending to be a Mac.
 *    We detect that case only to be explicit that it is NOT an iPhone —
 *    a real Mac (maxTouchPoints 0) fails the iPhone test the same way.
 */
export function isIPhone(d: DeviceSnapshot = fromNavigator()): boolean {
  const ua = d.userAgent;
  if (!/iPhone/i.test(ua)) return false;
  // some iPad UAs historically carried both tokens — iPad always wins
  if (/iPad/i.test(ua)) return false;
  return true;
}

/** iPadOS 13+ pretending to be a Mac — named so the exclusion is testable */
export function isIPadMasqueradingAsMac(
  d: DeviceSnapshot = fromNavigator(),
): boolean {
  return /Macintosh/i.test(d.userAgent) && d.maxTouchPoints > 1;
}

/**
 * Already installed and running as an app — the banner must never show.
 * `navigator.standalone` is iOS Safari's non-standard flag for home-screen
 * launches; display-mode covers Android/desktop PWAs.
 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  return (navigator as { standalone?: boolean }).standalone === true;
}
