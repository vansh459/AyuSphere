"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fadeRise } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

type Citation = { type: string; id: string; label: string };
type Exchange = {
  question: string;
  answer: string;
  citations: Citation[];
  grounded: boolean;
};

const SUGGESTIONS = [
  "Which sites are behind target?",
  "Any open SAEs near their reporting deadline?",
  "Summarize the trial portfolio",
];

export function CopilotClient() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Exchange[]>([]);

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "request failed");
      setHistory((h) => [{ question: q, ...json }, ...h]);
      setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="glass flex flex-col gap-3 p-4">
        <form
          className="flex gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about recruitment, safety, or the portfolio…"
            disabled={busy}
          />
          <Button type="submit" disabled={busy || !question.trim()}>
            {busy ? "Thinking…" : "Ask"}
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void ask(s)}
              disabled={busy}
              className="rounded-full border border-line bg-surface px-3 py-1 opacity-70 transition-colors duration-200 hover:border-primary hover:opacity-100"
            >
              {s}
            </button>
          ))}
        </div>
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : null}
      </div>

      <AnimatePresence>
        {history.map((ex, i) => (
          <motion.div
            key={`${ex.question}-${i}`}
            variants={fadeRise}
            initial="hidden"
            animate="visible"
          >
            <Card className="flex flex-col gap-3">
              <p className="font-bold">{ex.question}</p>
              <p className="whitespace-pre-wrap">{ex.answer}</p>
              <div className="flex flex-wrap items-center gap-2">
                {ex.grounded ? (
                  <>
                    <span className="microlabel">Evidence</span>
                    {ex.citations.map((c) => (
                      <Badge key={c.id} tone="info">
                        {c.label}
                      </Badge>
                    ))}
                  </>
                ) : (
                  <Badge tone="warning">no supporting records — declined</Badge>
                )}
              </div>
            </Card>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
