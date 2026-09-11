import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    // PGlite (WASM Postgres) cold-starts once per file; under parallel
    // workers that exceeds the default 10s hook timeout (D-019/D-020).
    hookTimeout: 60_000,
    isolate: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
