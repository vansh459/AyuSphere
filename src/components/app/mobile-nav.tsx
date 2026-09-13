"use client";

/**
 * Mobile navigation (UI audit T6.4) — the desktop sidebar is max-md:hidden
 * and phones previously had NO way to navigate. A hamburger in the topbar
 * opens a slide-in drawer rendering the SAME grouped NavList; closes on
 * backdrop tap, the X, or any route click.
 */
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Leaf, Menu, X } from "lucide-react";
import { DUR, EASE } from "@/lib/motion";
import { useLiveBadges } from "@/components/app/live-badges";
import { NavList } from "@/components/app/nav-list";
import type { GroupedNav } from "@/lib/nav";

export function MobileNav({
  groups,
  badges,
}: {
  groups: GroupedNav;
  badges?: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const liveBadges = useLiveBadges(badges ?? {});
  const reduced = useReducedMotion();

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-10 items-center justify-center rounded-xl text-ink transition-colors duration-200 hover:bg-primary-soft"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      <AnimatePresence>
        {open ? (
          <>
            <motion.button
              type="button"
              aria-label="Close navigation"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : DUR.standard, ease: EASE }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-black/40"
            />
            <motion.div
              initial={reduced ? { opacity: 0 } : { x: "-100%" }}
              animate={reduced ? { opacity: 1 } : { x: 0 }}
              exit={reduced ? { opacity: 0 } : { x: "-100%" }}
              transition={{ duration: reduced ? 0 : DUR.page, ease: EASE }}
              className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-primary-deep text-white shadow-[0_16px_48px_rgba(0,0,0,0.35)]"
              role="dialog"
              aria-label="Navigation"
            >
              <div className="flex items-center justify-between px-4 py-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
                    <Leaf className="h-5 w-5" />
                  </span>
                  <p className="font-bold leading-tight">AyuSphere</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-white/70 transition-colors duration-200 hover:bg-white/10 hover:text-white"
                  aria-label="Close navigation"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <nav className="scroll-dark flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-6">
                <NavList
                  groups={groups}
                  badges={liveBadges}
                  onNavigate={() => setOpen(false)}
                />
              </nav>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
