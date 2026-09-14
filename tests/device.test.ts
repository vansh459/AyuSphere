/**
 * T6.13 — phone detection for the PWA install banner. The iPad exclusions
 * are the point of this suite: iPadOS 13+ reports "Macintosh" in its UA, so
 * a naive check would banner iPads (or, worse, real Macs).
 */
import { describe, expect, it } from "vitest";
import {
  isAndroidPhone,
  isIPadMasqueradingAsMac,
  isIPhone,
} from "@/lib/device";

const UA = {
  androidPhone:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  androidFirefoxPhone:
    "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipadLegacy:
    "Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1",
  // iPadOS 13+ desktop-mode UA — indistinguishable from macOS except by touch
  ipadAsMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

describe("isAndroidPhone", () => {
  it("accepts Android phones (Chrome and Firefox)", () => {
    expect(isAndroidPhone({ userAgent: UA.androidPhone, maxTouchPoints: 5 })).toBe(true);
    expect(isAndroidPhone({ userAgent: UA.androidFirefoxPhone, maxTouchPoints: 5 })).toBe(true);
  });

  it("rejects Android tablets (no 'Mobile' token) and desktops", () => {
    expect(isAndroidPhone({ userAgent: UA.androidTablet, maxTouchPoints: 5 })).toBe(false);
    expect(isAndroidPhone({ userAgent: UA.windowsChrome, maxTouchPoints: 0 })).toBe(false);
    expect(isAndroidPhone({ userAgent: UA.macSafari, maxTouchPoints: 0 })).toBe(false);
    expect(isAndroidPhone({ userAgent: UA.iphone, maxTouchPoints: 5 })).toBe(false);
  });
});

describe("isIPhone", () => {
  it("accepts iPhone Safari", () => {
    expect(isIPhone({ userAgent: UA.iphone, maxTouchPoints: 5 })).toBe(true);
  });

  it("rejects legacy iPads, desktop Macs and Windows", () => {
    expect(isIPhone({ userAgent: UA.ipadLegacy, maxTouchPoints: 5 })).toBe(false);
    expect(isIPhone({ userAgent: UA.macSafari, maxTouchPoints: 0 })).toBe(false);
    expect(isIPhone({ userAgent: UA.windowsChrome, maxTouchPoints: 0 })).toBe(false);
  });

  it("rejects iPadOS 13+ masquerading as a Mac (Macintosh UA + touch)", () => {
    const ipad = { userAgent: UA.ipadAsMac, maxTouchPoints: 5 };
    expect(isIPhone(ipad)).toBe(false);
    expect(isIPadMasqueradingAsMac(ipad)).toBe(true);
    // and a REAL Mac (no touch) is not flagged as an iPad
    expect(
      isIPadMasqueradingAsMac({ userAgent: UA.macSafari, maxTouchPoints: 0 }),
    ).toBe(false);
  });

  it("phone gate: exactly the two allowed device classes pass", () => {
    const pass = (userAgent: string, maxTouchPoints: number) =>
      isAndroidPhone({ userAgent, maxTouchPoints }) ||
      isIPhone({ userAgent, maxTouchPoints });
    expect(pass(UA.androidPhone, 5)).toBe(true);
    expect(pass(UA.iphone, 5)).toBe(true);
    expect(pass(UA.androidTablet, 5)).toBe(false);
    expect(pass(UA.ipadLegacy, 5)).toBe(false);
    expect(pass(UA.ipadAsMac, 5)).toBe(false);
    expect(pass(UA.macSafari, 0)).toBe(false);
    expect(pass(UA.windowsChrome, 0)).toBe(false);
  });
});
