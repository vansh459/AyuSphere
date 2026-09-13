"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, CheckCircle2, FileImage, Send, UploadCloud } from "lucide-react";
import { fadeRise } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export type VisitOption = { id: string; label: string };

type MappedField = { value: string | number; confidence: number };
type Extraction = {
  id: string;
  status: string;
  mappedFields: Record<string, MappedField> | null;
  validationFlags: { field: string; message: string }[];
};

const FIELD_LABELS: Record<string, string> = {
  sbp: "Systolic BP",
  dbp: "Diastolic BP",
  pulse: "Pulse",
  dose_mg: "Intervention dose",
  notes: "Clinical notes",
};

export function AssistantPanel({
  visits,
  canUseCopilot,
}: {
  visits: VisitOption[];
  canUseCopilot: boolean;
}) {
  const [tab, setTab] = useState<"chat" | "doc">("doc");
  const [visitId, setVisitId] = useState(visits[0]?.id ?? "");
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState<{ q: string; a: string }[]>([]);

  async function upload(file: File) {
    if (!visitId) {
      setError("No open visit to attach the document to.");
      return;
    }
    setBusy(true);
    setError(null);
    setExtraction(null);
    setFileName(file.name);
    try {
      const form = new FormData();
      form.set("visitId", visitId);
      // phone photos are often 4–8MB; Vercel rejects bodies > 4.5MB
      const { prepareImageForUpload } = await import("@/lib/image");
      form.set("image", await prepareImageForUpload(file));
      const res = await fetch("/api/ai/extract", { method: "POST", body: form });
      // platform-level failures (e.g. 413) return plain text, not JSON
      const raw = await res.text();
      let json: { error?: string; extraction?: unknown } = {};
      try {
        json = JSON.parse(raw);
      } catch {
        /* non-JSON body — handled below via status */
      }
      if (!res.ok) {
        throw new Error(
          json.error ??
            (res.status === 413
              ? "The photo is too large to upload — please retake it at a lower resolution."
              : `extraction failed (HTTP ${res.status})`),
        );
      }
      setExtraction(json.extraction as Parameters<typeof setExtraction>[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "extraction failed");
    } finally {
      setBusy(false);
    }
  }

  async function ask() {
    if (!question.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "request failed");
      setChat((c) => [{ q: question, a: json.answer }, ...c]);
      setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex w-full flex-col overflow-hidden rounded-2xl bg-primary-deep xl:h-[40vh] xl:w-80 xl:shrink-0">
      <div className="flex items-center gap-2 px-4 py-3 text-white">
        <Bot className="h-4 w-4" />
        <p className="font-bold">AI Assistant</p>
        <Badge tone="success" className="bg-primary text-white">
          Beta
        </Badge>
      </div>

      <div className="scroll-light flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-t-2xl bg-surface p-4">
        {/* tabs */}
        <div className="flex rounded-xl border border-line p-1">
          {(
            [
              ["chat", "Chat"],
              ["doc", "Document to Data"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "flex-1 rounded-lg px-3 py-1.5 font-medium transition-colors duration-200",
                tab === key ? "bg-primary text-white" : "opacity-60 hover:opacity-100",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "doc" ? (
          <div className="flex flex-col gap-3">
            <select
              value={visitId}
              onChange={(e) => setVisitId(e.target.value)}
              className="h-9 w-full rounded-xl border border-line bg-surface px-2 outline-none focus:border-primary"
              aria-label="Attach to visit"
            >
              {visits.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>

            <label
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line px-4 py-8 text-center transition-colors duration-200 hover:border-primary",
                busy && "pointer-events-none opacity-60",
              )}
            >
              <UploadCloud className="h-8 w-8 text-primary" />
              <p className="opacity-70">
                {busy
                  ? "Processing image…"
                  : "Drag & drop lab report / prescription or click to upload"}
              </p>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
            </label>
            <p className="opacity-50">Supports: JPG, PNG (max 10 MB)</p>

            {error ? (
              <p role="alert" className="text-danger">
                {error}
              </p>
            ) : null}

            <AnimatePresence>
              {extraction ? (
                <motion.div
                  variants={fadeRise}
                  initial="hidden"
                  animate="visible"
                  className="flex flex-col gap-3"
                >
                  <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
                    <FileImage className="h-4 w-4 text-primary" />
                    <p className="min-w-0 flex-1 truncate font-medium">
                      {fileName}
                    </p>
                  </div>
                  {extraction.status === "review" ? (
                    <>
                      <p className="flex items-center gap-1.5 text-success">
                        <CheckCircle2 className="h-4 w-4" /> Image processed
                        successfully
                      </p>
                      <p className="microlabel">Extracted Information</p>
                      <div className="overflow-hidden rounded-xl border border-line">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="border-b border-line bg-bg">
                              <th className="px-3 py-2 font-medium">Parameter</th>
                              <th className="px-3 py-2 font-medium">Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(extraction.mappedFields ?? {}).map(
                              ([name, f]) => (
                                <tr key={name} className="border-b border-line last:border-0">
                                  <td className="px-3 py-2 opacity-70">
                                    {FIELD_LABELS[name] ?? name}
                                  </td>
                                  <td className="px-3 py-2 font-medium">
                                    {String(f.value)}
                                    <span className="ml-2 opacity-50">
                                      {(f.confidence * 100).toFixed(0)}%
                                    </span>
                                  </td>
                                </tr>
                              ),
                            )}
                          </tbody>
                        </table>
                      </div>
                      <Link
                        href="/doctor-note"
                        className="flex h-10 items-center justify-center gap-2 rounded-[0.875rem] bg-primary-deep font-medium text-white transition-transform duration-200 hover:-translate-y-[2px]"
                      >
                        Populate in eCRF →
                      </Link>
                      <p className="opacity-50">
                        Doctor review & approval required before it becomes a
                        record.
                      </p>
                    </>
                  ) : (
                    <p className="text-danger">
                      {extraction.validationFlags?.[0]?.message ??
                        "Image could not be processed — please recapture."}
                    </p>
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-3">
            {canUseCopilot ? (
              <>
                <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
                  {chat.length === 0 ? (
                    <p className="opacity-50">
                      Ask about recruitment, safety, or the portfolio — answers
                      cite live records.
                    </p>
                  ) : (
                    chat.map((c, i) => (
                      <div key={i} className="flex flex-col gap-1">
                        <p className="font-medium">{c.q}</p>
                        <p className="opacity-70">{c.a}</p>
                      </div>
                    ))
                  )}
                </div>
                {error && tab === "chat" ? (
                  <p className="text-danger">{error}</p>
                ) : null}
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void ask();
                  }}
                >
                  <input
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ask anything about your trials…"
                    className="h-10 flex-1 rounded-xl border border-line bg-surface px-3 outline-none focus:border-primary"
                  />
                  <button
                    type="submit"
                    disabled={busy || !question.trim()}
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white disabled:opacity-50"
                    aria-label="Send"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </form>
              </>
            ) : (
              <p className="opacity-70">
                Your role does not include Copilot access.
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
