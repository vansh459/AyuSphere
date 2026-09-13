"use client";

/**
 * TermPicker — styled autocomplete replacing native <datalist> (which is
 * browser-default, unstylable, and unreliable on mobile). Works inside
 * server-action forms: the visible input carries the form `name`.
 * Keyboard: ↑/↓ navigate, Enter selects, Esc closes.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type TermOption = { value: string; hint?: string };

export function TermPicker({
  id,
  name,
  options,
  placeholder,
  required,
  minLength,
  defaultValue = "",
}: {
  id: string;
  name: string;
  options: TermOption[];
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const pool = q
      ? options.filter(
          (o) =>
            o.value.toLowerCase().includes(q) ||
            o.hint?.toLowerCase().includes(q),
        )
      : options;
    // exact-prefix matches first, then the rest
    return [...pool]
      .sort((a, b) => {
        const ap = a.value.toLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.value.toLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp || a.value.localeCompare(b.value);
      })
      .slice(0, 8);
  }, [value, options]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function select(v: string) {
    setValue(v);
    setOpen(false);
  }

  const exact = options.some(
    (o) => o.value.toLowerCase() === value.trim().toLowerCase(),
  );

  return (
    <div ref={rootRef} className="relative">
      <input
        id={id}
        name={name}
        value={value}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            setOpen(true);
            return;
          }
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && matches[active]) {
            e.preventDefault(); // select instead of submitting the form
            select(matches[active].value);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="h-10 w-full rounded-[0.875rem] border border-line bg-surface px-3 pr-9 text-ink transition-all duration-200 outline-none placeholder:opacity-50 focus:border-primary focus:ring-2 focus:ring-primary/25"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 opacity-40">
        {exact ? (
          <Check className="h-4 w-4 text-success" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </span>

      {open && matches.length > 0 ? (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className="clay scroll-light absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto p-1.5"
        >
          {matches.map((o, i) => (
            <li key={o.value} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus, avoid blur-before-click
                  select(o.value);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex w-full cursor-pointer items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-200",
                  i === active ? "bg-primary-soft" : "hover:bg-primary-soft",
                )}
              >
                <span className="min-w-0 truncate font-medium">{o.value}</span>
                {o.hint ? (
                  <span className="shrink-0 opacity-50">{o.hint}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
