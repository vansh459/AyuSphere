import { describe, expect, it } from "vitest";
import { detectPreviewKind } from "@/components/app/doc-preview";

describe("document preview type detection", () => {
  it("detects images from mime, data-URL prefix, and extension", () => {
    expect(detectPreviewKind("https://x/y.bin", "image/png")).toBe("image");
    expect(detectPreviewKind("data:image/jpeg;base64,AAAA")).toBe("image");
    expect(detectPreviewKind("https://x/scan.JPG", null, "scan.JPG")).toBe("image");
    expect(detectPreviewKind("blob://z", null, "photo.jfif")).toBe("image");
  });

  it("detects pdf and text/csv for iframe rendering", () => {
    expect(detectPreviewKind("data:application/pdf;base64,AA")).toBe("pdf");
    expect(detectPreviewKind("https://x/protocol.pdf")).toBe("pdf");
    expect(detectPreviewKind("data:text/plain;base64,AA")).toBe("text");
    expect(detectPreviewKind("https://x/AYU-001-sdtm-dm.csv")).toBe("text");
  });

  it("falls back to download-only for unknown types", () => {
    expect(detectPreviewKind("https://x/archive.zip")).toBe("other");
    expect(
      detectPreviewKind("https://x/blob", "application/octet-stream", "raw"),
    ).toBe("other");
  });

  it("query strings don't confuse extension sniffing", () => {
    expect(detectPreviewKind("https://x/doc.pdf?token=abc.def")).toBe("pdf");
  });
});
