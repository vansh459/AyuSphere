"use client";

/**
 * Topbar quick-jump (UI audit T6.4) — replaces the dead search input.
 * Debounced RBAC-scoped lookup: your screens, trials, participants.
 * Enter opens the first result; Esc or clicking away closes.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, FlaskConical, Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";

type Result = {
  kind: "screen" | "trial" | "participant";
  label: string;
  hint: string;
  href: string;
};

const KIND_ICON = {
  screen: FileText,
  trial: FlaskConical,
  participant: Users,
} as const;

export function QuickSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // close on click-away
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function onChange(value: string) {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(value)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { results?: Result[] };
        setResults(json.results ?? []);
        setOpen(true);
      } catch {
        /* transient */
      }
    }, 250);
  }

  function go(href: string) {
    setOpen(false);
    setQ("");
    setResults([]);
    router.push(href);
  }

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1 md:max-w-xl">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-40" />
      <input
        type="search"
        value={q}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) {
            e.preventDefault();
            go(results[0].href);
          }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search screens, trials, participants…"
        aria-label="Quick search"
        className="h-10 w-full rounded-xl border border-line bg-bg pl-9 pr-3 outline-none transition-colors duration-200 focus:border-primary"
      />
      {open && results.length > 0 ? (
        <div className="clay absolute left-0 right-0 top-full z-30 mt-2 max-h-80 overflow-y-auto p-1.5">
          {results.map((r) => {
            const Icon = KIND_ICON[r.kind];
            return (
              <button
                key={`${r.kind}-${r.href}-${r.label}`}
                type="button"
                onClick={() => go(r.href)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left",
                  "transition-colors duration-200 hover:bg-primary-soft",
                )}
              >
                <Icon className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {r.label}
                </span>
                <span className="shrink-0 opacity-50">{r.hint}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {open && results.length === 0 && q.trim().length >= 2 ? (
        <div className="clay absolute left-0 right-0 top-full z-30 mt-2 p-3">
          <p className="opacity-60">No matches for “{q.trim()}”.</p>
        </div>
      ) : null}
    </div>
  );
}
