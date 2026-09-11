/**
 * AyuSphere motion catalog — docs/technology.md §2.5 (D-009).
 * Components import from here; ad-hoc inline motion values are a review blocker.
 * Pure data (no React) so tests can import it in a node environment.
 */

export const DUR = {
  /** hover, press, toggle */
  micro: 0.2,
  /** card enter, dropdown, accordion */
  standard: 0.3,
  /** page / modal */
  page: 0.45,
} as const;

/** Airbnb-style: fast out, soft landing */
export const EASE = [0.32, 0.72, 0, 1] as const;

export const SPRING = { type: "spring", stiffness: 380, damping: 30 } as const;

/** seconds between staggered dashboard children */
export const STAGGER = 0.04;

export const fadeRise = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR.standard, ease: EASE },
  },
} as const;

export const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: STAGGER } },
} as const;

export const pageEnter = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR.page, ease: EASE },
  },
} as const;

export const overlayFade = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DUR.standard, ease: EASE } },
  exit: { opacity: 0, transition: { duration: DUR.micro, ease: EASE } },
} as const;

export const sheetSlide = {
  hidden: { opacity: 0, x: 24 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: DUR.page, ease: EASE },
  },
  exit: {
    opacity: 0,
    x: 24,
    transition: { duration: DUR.standard, ease: EASE },
  },
} as const;

/** clay hover lift: translate up + deepen shadow via whileHover */
export const lift = {
  whileHover: { y: -2, transition: SPRING },
  whileTap: { scale: 0.98 },
} as const;
