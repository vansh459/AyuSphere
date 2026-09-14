"use client";

/**
 * Universal document preview popup — used by the Documents library, trial
 * detail, chat attachments, and the Extractions gallery. Images, PDFs and
 * text render inline; anything else gets a download affordance.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, Eye, FileText, X } from "lucide-react";
import { fadeRise, overlayFade } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type PreviewKind = "image" | "pdf" | "text" | "other";

/** pure + unit-tested: decide how to render from mime / data-URL / filename */
export function detectPreviewKind(
  url: string,
  contentType?: string | null,
  name?: string | null,
): PreviewKind {
  const mime =
    contentType ??
    (url.startsWith("data:") ? url.slice(5, url.indexOf(";")) : "");
  const ext = (name ?? url).split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "jfif"].includes(ext)) {
    return "image";
  }
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("text/") || ["txt", "csv", "md", "json", "xml"].includes(ext)) {
    return "text";
  }
  return "other";
}

export function DocPreview({
  url,
  name,
  contentType,
  trigger,
  triggerClassName,
}: {
  url: string;
  name: string;
  contentType?: string | null;
  /** custom trigger node (e.g. a thumbnail); default is an Eye button */
  trigger?: React.ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const kind = detectPreviewKind(url, contentType, name);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("cursor-pointer text-left", triggerClassName)}
        aria-label={`Preview ${name}`}
      >
        {trigger ?? (
          <span className="inline-flex items-center gap-1.5 font-medium text-primary">
            <Eye className="h-4 w-4" /> Preview
          </span>
        )}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            variants={overlayFade}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"
            onClick={() => setOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label={`Preview of ${name}`}
          >
            <motion.div
              variants={fadeRise}
              className="clay flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                <p className="flex min-w-0 items-center gap-2 font-bold">
                  <FileText className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate">{name}</span>
                </p>
                <div className="flex shrink-0 items-center gap-1">
                  <a
                    href={url}
                    download={name}
                    className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors duration-200 hover:bg-primary-soft"
                    aria-label={`Download ${name}`}
                  >
                    <Download className="h-4 w-4" />
                  </a>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl transition-colors duration-200 hover:bg-primary-soft"
                    aria-label="Close preview"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="min-h-40 flex-1 overflow-auto bg-bg p-4">
                {kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt={name}
                    loading="lazy"
                    decoding="async"
                    className="mx-auto max-h-[70vh] w-auto max-w-full rounded-xl object-contain"
                  />
                ) : kind === "pdf" || kind === "text" ? (
                  <iframe
                    src={url}
                    title={name}
                    className="h-[70vh] w-full rounded-xl border border-line bg-surface"
                  />
                ) : (
                  <div className="flex h-40 flex-col items-center justify-center gap-3">
                    <p className="opacity-70">
                      No inline preview for this file type.
                    </p>
                    <a
                      href={url}
                      download={name}
                      className="inline-flex items-center gap-2 rounded-[0.875rem] bg-primary px-4 py-2 font-medium text-white"
                    >
                      <Download className="h-4 w-4" /> Download {name}
                    </a>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
