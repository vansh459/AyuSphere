import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as motion from "@/lib/motion";

const css = readFileSync(
  path.resolve(__dirname, "../src/app/globals.css"),
  "utf8",
);

describe("T0.2 — typography: one font, exactly two sizes (D-008)", () => {
  it("wipes Tailwind's default text scale", () => {
    expect(css).toContain("--text-*: initial");
  });

  it("defines exactly two text-size tokens (body, heading)", () => {
    // size tokens look like `--text-<name>: <value>` — line-height modifiers
    // (`--text-<name>--line-height`) are not sizes.
    const sizeTokens = [...css.matchAll(/--text-([a-z-]+):\s/g)]
      .map((m) => m[1])
      .filter((name) => name !== "*" && !name.includes("--"))
      .filter((name) => !name.endsWith("-line-height"));
    expect(sizeTokens.sort()).toEqual(["body", "heading"]);
  });

  it("body is 14px and heading is 24px", () => {
    expect(css).toMatch(/--text-body:\s*0\.875rem/);
    expect(css).toMatch(/--text-heading:\s*1\.5rem/);
  });

  it("uses a single font family (Plus Jakarta Sans variable)", () => {
    expect(css).toMatch(/--font-sans:\s*var\(--font-jakarta\)/);
    const fontTokens = [...css.matchAll(/--font-(sans|serif|mono):/g)].map(
      (m) => m[1],
    );
    expect(fontTokens).toEqual(["sans"]);
  });
});

describe("T0.2 — color tokens (D-015)", () => {
  const required = [
    "primary",
    "primary-soft",
    "primary-deep",
    "bg",
    "surface",
    "ink",
    "line",
    "success",
    "warning",
    "danger",
    "info",
  ];
  it.each(required)("defines --color-%s", (token) => {
    expect(css).toContain(`--color-${token}:`);
  });

  it("wipes Tailwind's default palette so only tokens exist", () => {
    expect(css).toContain("--color-*: initial");
  });
});

describe("T0.2 — surface utilities (D-007)", () => {
  it("defines glass and clay exactly once each", () => {
    expect(css.match(/@utility glass(?![\w-])/g)).toHaveLength(1);
    expect(css.match(/@utility clay(?![\w-])/g)).toHaveLength(1);
    expect(css).toContain("backdrop-filter: blur(16px)");
  });
});

describe("T0.2 — motion catalog (D-009)", () => {
  it("exposes the fixed duration vocabulary", () => {
    expect(motion.DUR).toEqual({ micro: 0.2, standard: 0.3, page: 0.45 });
  });

  it("uses the Airbnb-style easing curve", () => {
    expect(motion.EASE).toEqual([0.32, 0.72, 0, 1]);
  });

  it("exports the shared variants", () => {
    for (const v of [
      motion.fadeRise,
      motion.staggerContainer,
      motion.pageEnter,
      motion.overlayFade,
      motion.sheetSlide,
      motion.lift,
    ]) {
      expect(v).toBeTypeOf("object");
    }
    expect(motion.SPRING.stiffness).toBe(380);
    expect(motion.STAGGER).toBe(0.04);
  });
});
