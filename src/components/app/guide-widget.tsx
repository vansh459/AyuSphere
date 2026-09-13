"use client";

/**
 * Sphera — floating role-aware guide (D-022).
 * Reactive leaf-orb (idle / listening / thinking / talking states via the
 * motion catalog) + glass chat panel streaming from /api/guide.
 */
import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type TargetAndTransition,
  type Transition,
} from "framer-motion";
import { Leaf, Send, X } from "lucide-react";
import { DUR, EASE, sheetSlide } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { GUIDE_NAME } from "@/lib/guide/prompt";

type OrbState = "idle" | "listening" | "thinking" | "talking";
type Turn = { role: "user" | "assistant"; content: string };

/** markdown-lite: **bold** for UI labels + numbered/bulleted lines */
function renderLite(text: string): React.ReactNode {
  return text.split("\n").map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((seg, j) =>
      seg.startsWith("**") && seg.endsWith("**") ? (
        <strong key={j}>{seg.slice(2, -2)}</strong>
      ) : (
        seg
      ),
    );
    return (
      <span key={i} className="block min-h-[1em]">
        {parts}
      </span>
    );
  });
}

const ORB_ANIM: Record<OrbState, TargetAndTransition> = {
  idle: { scale: [1, 1.06, 1], rotate: 0 },
  listening: { scale: 1.08, rotate: -8 },
  thinking: { scale: [1, 1.12, 1], rotate: [0, 12, -12, 0] },
  talking: { scale: [1, 1.05, 1], rotate: 0 },
};

const ORB_TRANSITION: Record<OrbState, Transition> = {
  idle: { duration: 3, repeat: Infinity, ease: "easeInOut" },
  listening: { duration: DUR.standard, ease: EASE },
  thinking: { duration: 0.9, repeat: Infinity, ease: "easeInOut" },
  talking: { duration: 0.5, repeat: Infinity, ease: "easeInOut" },
};

export function GuideWidget({ userName }: { userName: string }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [orb, setOrb] = useState<OrbState>("idle");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const greetedRef = useRef(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);

  async function ask(opts: { message?: string; greet?: boolean }) {
    setError(null);
    setOrb("thinking");
    if (opts.message) {
      setTurns((t) => [...t, { role: "user", content: opts.message! }]);
    }
    try {
      const res = await fetch("/api/guide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: opts.message,
          greet: opts.greet,
          history: turns.slice(-8),
        }),
      });
      if (!res.ok || !res.body) {
        const raw = await res.text();
        let msg = `The guide is unavailable (HTTP ${res.status}).`;
        try {
          msg = (JSON.parse(raw) as { error?: string }).error ?? msg;
        } catch {
          /* keep default */
        }
        throw new Error(msg);
      }
      // stream into a fresh assistant turn
      setTurns((t) => [...t, { role: "assistant", content: "" }]);
      setOrb("talking");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (; ;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setTurns((t) => {
          const next = [...t];
          next[next.length - 1] = {
            role: "assistant",
            content: next[next.length - 1].content + chunk,
          };
          return next;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "The guide is unavailable.");
    } finally {
      setOrb(open ? "listening" : "idle");
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    setOrb(next ? "listening" : "idle");
    if (next && !greetedRef.current) {
      greetedRef.current = true;
      const seen = sessionStorage.getItem("sphera-greeted");
      if (!seen) {
        sessionStorage.setItem("sphera-greeted", "1");
        void ask({ greet: true });
      }
    }
  }

  function send() {
    const msg = input.trim();
    if (!msg || orb === "thinking") return;
    setInput("");
    void ask({ message: msg });
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      <AnimatePresence>
        {open ? (
          <motion.div
            variants={sheetSlide}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="flex h-[30rem] w-[23rem] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_16px_48px_rgba(28,30,29,0.18)] max-md:w-[calc(100vw-2.5rem)]"
            role="dialog"
            aria-label={`${GUIDE_NAME} guide`}
          >
            <div className="flex items-center justify-between border-b border-line bg-primary-soft/50 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-white shadow-xs">
                  <Leaf className="h-4 w-4" />
                </span>
                <div>
                  <p className="font-bold leading-tight text-primary-deep">
                    {GUIDE_NAME}
                    <span className="ml-2 font-medium opacity-60">your guide</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={toggle}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-ink/70 transition-colors duration-200 hover:bg-primary-soft hover:text-ink"
                aria-label="Close guide"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div ref={scrollRef} className="scroll-light min-h-0 flex-1 space-y-3 overflow-y-auto bg-bg/50 p-3.5">
              {turns.length === 0 && orb !== "thinking" ? (
                <div className="rounded-2xl border border-line/60 bg-surface p-3.5 shadow-xs">
                  <p className="font-bold text-ink">
                    Hi {userName.split(" ")[0]} !
                  </p>
                  <p className="mt-1 text-ink/70">
                    Ask me how anything on this screen works or what you can do next.
                  </p>
                </div>
              ) : null}
              {turns.map((t, i) => (
                <div
                  key={i}
                  className={cn(
                    "max-w-[88%] rounded-2xl px-3.5 py-2.5 shadow-xs",
                    t.role === "user"
                      ? "ml-auto rounded-tr-xs bg-primary text-white font-medium"
                      : "rounded-tl-xs border border-line/70 bg-surface text-ink",
                  )}
                >
                  {renderLite(t.content)}
                </div>
              ))}
              {orb === "thinking" ? (
                <div className="flex items-center gap-2 text-ink/60 px-1 py-1">
                  <span className="inline-block h-2 w-2 animate-ping rounded-full bg-primary" />
                  <p>{GUIDE_NAME} is thinking…</p>
                </div>
              ) : null}
              {error ? (
                <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-danger">
                  {error}
                </div>
              ) : null}
            </div>

            <form
              className="flex items-center gap-2 border-t border-line bg-surface p-3"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="How do I…?"
                className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-bg/60 px-3.5 text-ink outline-none transition-colors duration-200 focus:border-primary focus:bg-surface"
              />
              <button
                type="submit"
                disabled={!input.trim() || orb === "thinking"}
                className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-primary-deep text-white shadow-sm transition-all duration-200 hover:bg-primary active:bg-primary-deep disabled:cursor-not-allowed disabled:bg-primary-deep/85 disabled:text-white/80"
                aria-label="Send to guide"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* the leaf-orb */}
      <motion.button
        type="button"
        onClick={toggle}
        aria-label={open ? `Close ${GUIDE_NAME}` : `Open ${GUIDE_NAME}, your in-app guide`}
        className="relative flex h-14 w-14 cursor-pointer items-center justify-center rounded-full"
        animate={reduced ? { opacity: 1 } : ORB_ANIM[orb]}
        transition={reduced ? { duration: 0 } : ORB_TRANSITION[orb]}
        whileHover={reduced ? undefined : { scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        style={{
          background:
            "radial-gradient(circle at 32% 30%, #2ea060 0%, #1b7a43 55%, #0f5230 100%)",
          boxShadow:
            orb === "thinking" || orb === "talking"
              ? "0 0 0 6px rgba(27,122,67,0.18), 0 8px 24px rgba(15,82,48,0.45)"
              : "0 0 0 3px rgba(27,122,67,0.12), 0 6px 18px rgba(15,82,48,0.35)",
        }}
      >
        <Leaf className="h-6 w-6 text-white" />
        <span className="microlabel sr-only">{GUIDE_NAME}</span>
      </motion.button>
    </div>
  );
}
