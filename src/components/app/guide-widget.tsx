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
      for (;;) {
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
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      <AnimatePresence>
        {open ? (
          <motion.div
            variants={sheetSlide}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="glass flex h-[28rem] w-80 flex-col overflow-hidden max-md:w-[calc(100vw-2.5rem)]"
            role="dialog"
            aria-label={`${GUIDE_NAME} guide`}
          >
            <div className="flex items-center justify-between border-b border-line/60 px-4 py-2.5">
              <p className="font-bold text-primary-deep">
                {GUIDE_NAME}
                <span className="ml-2 font-medium opacity-50">your guide</span>
              </p>
              <button
                type="button"
                onClick={toggle}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition-colors duration-200 hover:bg-primary-soft"
                aria-label="Close guide"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
              {turns.length === 0 && orb !== "thinking" ? (
                <p className="opacity-60">
                  Hi {userName.split(" ")[0]} — ask me how anything on this
                  screen works.
                </p>
              ) : null}
              {turns.map((t, i) => (
                <div
                  key={i}
                  className={cn(
                    "max-w-[90%] rounded-2xl px-3 py-2",
                    t.role === "user"
                      ? "ml-auto bg-primary text-white"
                      : "bg-surface shadow-[0_1px_3px_rgba(28,30,29,0.08)]",
                  )}
                >
                  {renderLite(t.content)}
                </div>
              ))}
              {orb === "thinking" ? (
                <p className="opacity-50">{GUIDE_NAME} is thinking…</p>
              ) : null}
              {error ? (
                <p role="alert" className="text-danger">
                  {error}
                </p>
              ) : null}
            </div>

            <form
              className="flex items-center gap-2 border-t border-line/60 p-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="How do I…?"
                className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 outline-none transition-colors duration-200 focus:border-primary"
              />
              <button
                type="submit"
                disabled={!input.trim() || orb === "thinking"}
                className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-primary text-white disabled:opacity-50"
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
