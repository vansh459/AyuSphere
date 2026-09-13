/**
 * T4.4 — design QA sweep (D-007/D-008): the two-text-sizes rule and the
 * "surfaces defined once" rule are enforced statically over src/.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx|ts|css)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const componentFiles = files.filter((f) => /\.tsx?$/.test(f));

/** Tailwind's default text-size utilities — none may exist (D-008) */
const FORBIDDEN_TEXT_SIZES =
  /\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b|text-\[\d/;

describe("T4.4 — one font, two sizes, everywhere", () => {
  it("no file uses a forbidden Tailwind text-size class", () => {
    const offenders: string[] = [];
    for (const f of componentFiles) {
      const content = readFileSync(f, "utf8");
      const m = content.match(FORBIDDEN_TEXT_SIZES);
      if (m) offenders.push(`${path.relative(SRC, f)} → ${m[0]}`);
    }
    expect(offenders, offenders.join("; ")).toHaveLength(0);
  });

  it("no inline fontSize styles sneak past the token system", () => {
    const offenders: string[] = [];
    for (const f of componentFiles) {
      const content = readFileSync(f, "utf8");
      if (/fontSize\s*:/.test(content)) offenders.push(path.relative(SRC, f));
    }
    expect(offenders, offenders.join("; ")).toHaveLength(0);
  });

  it("no second font family is imported anywhere", () => {
    const offenders: string[] = [];
    for (const f of componentFiles) {
      const content = readFileSync(f, "utf8");
      const fontImports = content.match(
        /from ["']next\/font\/google["']/g,
      );
      if (fontImports) {
        const names = content.match(/import\s*{([^}]+)}\s*from ["']next\/font\/google["']/);
        if (names && !/^\s*Plus_Jakarta_Sans\s*$/.test(names[1])) {
          offenders.push(`${path.relative(SRC, f)} → ${names[1].trim()}`);
        }
      }
    }
    expect(offenders, offenders.join("; ")).toHaveLength(0);
  });
});

describe("T4.4 — surfaces defined once (D-007)", () => {
  it("backdrop-blur exists ONLY in globals.css (.glass), never hand-rolled in components", () => {
    const offenders: string[] = [];
    for (const f of componentFiles) {
      const content = readFileSync(f, "utf8");
      if (/backdrop-blur|backdropFilter/.test(content)) {
        offenders.push(path.relative(SRC, f));
      }
    }
    expect(offenders, offenders.join("; ")).toHaveLength(0);
  });

  it("no raw hex colors in component class strings (tokens only, D-015)", () => {
    const offenders: string[] = [];
    for (const f of componentFiles) {
      const content = readFileSync(f, "utf8");
      // hex colors inside className / cva strings like bg-[#123456]
      const m = content.match(/\[(#[0-9a-fA-F]{3,8})\]/);
      if (m) offenders.push(`${path.relative(SRC, f)} → ${m[1]}`);
    }
    expect(offenders, offenders.join("; ")).toHaveLength(0);
  });
});
