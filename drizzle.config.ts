import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // only needed for `drizzle-kit migrate/push`; `generate` is offline
    url: process.env.DATABASE_URL ?? "postgres://user:pass@localhost/db",
  },
});
