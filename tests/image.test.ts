import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_DIMENSION,
  UPLOAD_TARGET_BYTES,
  needsDownscale,
  scaleFor,
} from "@/lib/image";

/**
 * Upload-size guard (production bug, 2026-09-12): Vercel rejects request
 * bodies over 4.5MB at the platform edge with a plain-text 413, so phone
 * photos (4–8MB) never reached /api/ai/extract. The client downscales
 * before uploading; these pin the sizing decisions.
 */
describe("doctor-note upload sizing", () => {
  it("keeps the target comfortably under Vercel's 4.5MB body cap", () => {
    expect(UPLOAD_TARGET_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });

  it("flags typical phone photos for downscaling, passes small captures through", () => {
    expect(needsDownscale(7.8 * 1024 * 1024)).toBe(true); // 12MP JPEG
    expect(needsDownscale(4.6 * 1024 * 1024)).toBe(true);
    expect(needsDownscale(900 * 1024)).toBe(false); // already small
    expect(needsDownscale(UPLOAD_TARGET_BYTES)).toBe(false); // boundary
  });

  it("caps the longest side while preserving aspect ratio", () => {
    // 4000x3000 landscape → longest side capped
    const s = scaleFor(4000, 3000);
    expect(4000 * s).toBe(MAX_UPLOAD_DIMENSION);
    expect(3000 * s).toBeCloseTo((3000 * MAX_UPLOAD_DIMENSION) / 4000);
    // portrait orientation uses the height
    const p = scaleFor(3000, 5333);
    expect(5333 * p).toBeCloseTo(MAX_UPLOAD_DIMENSION);
  });

  it("never upscales small or degenerate images", () => {
    expect(scaleFor(800, 600)).toBe(1);
    expect(scaleFor(MAX_UPLOAD_DIMENSION, 1200)).toBe(1);
    expect(scaleFor(0, 0)).toBe(1);
  });
});
