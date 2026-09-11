import { describe, expect, it } from "vitest";

describe("T0.1 — toolchain sanity", () => {
  it("runs TypeScript tests", () => {
    const x: number = 21;
    expect(x * 2).toBe(42);
  });

  it("resolves the @ alias into src/", async () => {
    const mod = await import("@/lib/motion");
    expect(mod.DUR).toBeDefined();
  });
});
