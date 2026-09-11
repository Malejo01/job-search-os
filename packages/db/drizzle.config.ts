import { defineConfig } from "drizzle-kit";
import { loadLocalEnv, requireDatabaseUrl } from "./src/env";

loadLocalEnv();

export default defineConfig({
  dialect: "postgresql",
  schema: "./schema.ts",
  out: "./drizzle",
  // Migraciones y drizzle-kit: conexión directa (unpooled); ver ADR-009
  dbCredentials: { url: requireDatabaseUrl({ purpose: "migration" }) },
  strict: true,
  verbose: true,
});
