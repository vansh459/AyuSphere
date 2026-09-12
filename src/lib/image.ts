/**
 * Client-side image preparation for the doctor-note upload.
 *
 * Vercel serverless functions reject request bodies over 4.5MB at the
 * platform edge (413 FUNCTION_PAYLOAD_TOO_LARGE, plain text — the route
 * never runs), and modern phone cameras produce 4–8MB JPEGs. Photos are
 * therefore downscaled in the browser before upload: OCR needs nothing
 * beyond ~2000px on the longest side.
 */

/** stay comfortably under the 4.5MB Vercel body cap (multipart overhead included) */
export const UPLOAD_TARGET_BYTES = 3 * 1024 * 1024;
/** longest side after downscaling — ample for handwriting OCR */
export const MAX_UPLOAD_DIMENSION = 2000;
/** JPEG qualities tried in order until the target size is met */
export const JPEG_QUALITY_STEPS = [0.85, 0.7, 0.55] as const;

/** scale factor that caps the longest side at `maxSide` (1 = no scaling) */
export function scaleFor(
  width: number,
  height: number,
  maxSide: number = MAX_UPLOAD_DIMENSION,
): number {
  const longest = Math.max(width, height);
  if (longest <= 0) return 1;
  return longest <= maxSide ? 1 : maxSide / longest;
}

export function needsDownscale(
  bytes: number,
  limit: number = UPLOAD_TARGET_BYTES,
): boolean {
  return bytes > limit;
}

/**
 * Downscale/re-encode a photo so it fits the upload budget. Falls back to
 * the original file if the browser cannot decode it (the server still
 * enforces its own size limit and reports a readable error).
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  if (!needsDownscale(file.size)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = scaleFor(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    for (const quality of JPEG_QUALITY_STEPS) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (blob && blob.size <= UPLOAD_TARGET_BYTES) {
        const base = file.name.replace(/\.[^.]+$/, "") || "note";
        return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
      }
    }
    return file;
  } catch {
    return file;
  }
}
