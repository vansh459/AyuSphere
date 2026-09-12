import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    // PGlite (WASM Postgres) cold-starts once per file; with 30+ files on
    // parallel workers (plus bcrypt cost-12 in fixtures) a loaded machine
    // can push a beforeAll past 60s (D-019/D-020).
    hookTimeout: 180_000,
    isolate: false,
    // cap workers: each file boots its own WASM Postgres — unbounded
    // parallelism thrashes rather than speeds up
    maxWorkers: 4,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
