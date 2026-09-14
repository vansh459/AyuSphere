"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fadeRise } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { prepareImageForUpload } from "@/lib/image";

export type VisitOption = { id: string; label: string };

type MappedField = {
  value: string | number;
  confidence: number;
  sourceText?: string;
};

type Extraction = {
  id: string;
  status: string;
  mappedFields: Record<string, MappedField> | null;
  validationFlags: { field: string; kind: string; message: string }[];
};

const LOW_CONFIDENCE = 0.75;

function confidenceTone(c: number): "success" | "warning" | "danger" {
  if (c >= 0.9) return "success";
  if (c >= LOW_CONFIDENCE) return "warning";
  return "danger";
}

export function DoctorNoteClient({
  visits,
  canApprove,
}: {
  visits: VisitOption[];
  canApprove: boolean;
}) {
  const [visitId, setVisitId] = useState(visits[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<"extract" | "approve" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [signPassword, setSignPassword] = useState("");
  const [done, setDone] = useState(false);

  const flagsByField = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const f of extraction?.validationFlags ?? []) {
      map.set(f.field, [...(map.get(f.field) ?? []), f.message]);
    }
    return map;
  }, [extraction]);

  const requiredTouches = useMemo(() => {
    if (!extraction?.mappedFields) return new Set<string>();
    const set = new Set<string>();
    for (const [name, f] of Object.entries(extraction.mappedFields)) {
      if (f.confidence < LOW_CONFIDENCE) set.add(name);
    }
    for (const f of extraction.validationFlags ?? []) {
      if (!f.field.startsWith("(")) set.add(f.field);
    }
    return set;
  }, [extraction]);

  const blockers = [...requiredTouches].filter((f) => !touched.has(f));

  async function extract() {
    if (!file || !visitId) return;
    setBusy("extract");
    setError(null);
    setExtraction(null);
    setDone(false);
    try {
      const form = new FormData();
      form.set("visitId", visitId);
      // phone photos are often 4–8MB; Vercel rejects bodies > 4.5MB
      form.set("image", await prepareImageForUpload(file));
      const res = await fetch("/api/ai/extract", { method: "POST", body: form });
      // platform-level failures (e.g. 413) return plain text, not JSON
      const raw = await res.text();
      let json: { error?: string; extraction?: Extraction } = {};
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
      if (!json.extraction) throw new Error("extraction failed");
      const ex: Extraction = json.extraction;
      setExtraction(ex);
      const initial: Record<string, string> = {};
      for (const [name, f] of Object.entries(ex.mappedFields ?? {})) {
        initial[name] = String(f.value);
      }
      setValues(initial);
      setTouched(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "extraction failed");
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!extraction) return;
    setBusy("approve");
    setError(null);
    try {
      const finalData: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        const n = Number(v);
        finalData[k] = v !== "" && !Number.isNaN(n) ? n : v;
      }
      const res = await fetch("/api/ai/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          extractionId: extraction.id,
          finalData,
          touchedFields: [...touched],
          password: signPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "approval failed");
      setSignPassword("");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "approval failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4">
        <CardTitle className="text-body font-bold">1 · Capture</CardTitle>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="visit">Participant visit</Label>
            <select
              id="visit"
              value={visitId}
              onChange={(e) => setVisitId(e.target.value)}
              className="h-10 w-full rounded-[0.875rem] border border-line bg-surface px-3 text-body outline-none focus:border-primary"
            >
              {visits.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="image">Note photo</Label>
            <Input
              id="image"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setPreview(f ? URL.createObjectURL(f) : null);
              }}
            />
          </div>
        </div>
        <Button onClick={extract} disabled={!file || !visitId || busy !== null}>
          {busy === "extract" ? "Reading note…" : "Extract to CRF draft"}
        </Button>
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : null}
      </Card>

      <AnimatePresence>
        {extraction && extraction.status === "rejected" ? (
          <motion.div variants={fadeRise} initial="hidden" animate="visible">
            <Card>
              <CardTitle className="text-body font-bold text-danger">
                Recapture needed
              </CardTitle>
              <p className="mt-2 opacity-70">
                {extraction.validationFlags?.[0]?.message ??
                  "The image could not be read."}
              </p>
            </Card>
          </motion.div>
        ) : null}

        {extraction && extraction.status === "review" ? (
          <motion.div
            variants={fadeRise}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-1 gap-6 lg:grid-cols-2"
          >
            <Card>
              <CardTitle className="text-body font-bold">
                Original note (source evidence)
              </CardTitle>
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview}
                  alt="Uploaded doctor note"
                  loading="lazy"
                  decoding="async"
                  className="mt-4 max-h-[480px] w-full rounded-xl object-contain"
                />
              ) : null}
            </Card>

            <Card className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-body font-bold">
                  2 · Review draft — confidence heatmap
                </CardTitle>
                <Badge tone="info">human-in-the-loop</Badge>
              </div>

              {Object.entries(extraction.mappedFields ?? {}).map(
                ([name, f]) => {
                  const flags = flagsByField.get(name) ?? [];
                  const needsTouch = requiredTouches.has(name);
                  const isTouched = touched.has(name);
                  return (
                    <div key={name} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`f-${name}`}>{name}</Label>
                        <Badge tone={confidenceTone(f.confidence)}>
                          {(f.confidence * 100).toFixed(0)}%
                        </Badge>
                        {needsTouch && !isTouched ? (
                          <Badge tone="warning">confirm</Badge>
                        ) : null}
                      </div>
                      <Input
                        id={`f-${name}`}
                        value={values[name] ?? ""}
                        onChange={(e) => {
                          setValues((v) => ({ ...v, [name]: e.target.value }));
                          setTouched((t) => new Set(t).add(name));
                        }}
                        onFocus={() =>
                          setTouched((t) => new Set(t).add(name))
                        }
                        className={cn(
                          needsTouch && !isTouched && "border-warning",
                        )}
                      />
                      {f.sourceText ? (
                        <p className="opacity-50">from note: “{f.sourceText}”</p>
                      ) : null}
                      {flags.map((m) => (
                        <p key={m} className="text-danger">
                          {m}
                        </p>
                      ))}
                    </div>
                  );
                },
              )}

              {done ? (
                <p className="font-bold text-success">
                  Approved — official CRF record created with full provenance.
                </p>
              ) : canApprove ? (
                <>
                  {blockers.length > 0 ? (
                    <p className="text-warning">
                      Confirm highlighted fields before approving:{" "}
                      {blockers.join(", ")}
                    </p>
                  ) : null}
                  {/* e-signature (D-022): password re-auth + meaning statement */}
                  <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
                    <Label htmlFor="sign-password">
                      Electronic signature — re-enter your password
                    </Label>
                    <Input
                      id="sign-password"
                      type="password"
                      autoComplete="current-password"
                      value={signPassword}
                      onChange={(e) => setSignPassword(e.target.value)}
                      placeholder="Password"
                    />
                    <p className="opacity-50">
                      “I approve this record as accurate and complete.”
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <Button
                      onClick={approve}
                      disabled={
                        busy !== null ||
                        blockers.length > 0 ||
                        signPassword.length === 0
                      }
                    >
                      {busy === "approve" ? "Committing…" : "Sign & approve as record"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy !== null}
                      onClick={async () => {
                        await fetch("/api/ai/approve", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            action: "reject",
                            extractionId: extraction.id,
                            reason: "doctor rejected draft",
                          }),
                        });
                        setExtraction(null);
                      }}
                    >
                      Reject draft
                    </Button>
                  </div>
                </>
              ) : (
                <p className="opacity-70">
                  Draft saved for PI review — only the PI can approve it into
                  the record.
                </p>
              )}
            </Card>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
