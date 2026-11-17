import { defineConfig } from "vitest/config";

// Unit tests de apps/web (R12-12): solo los `*.test.ts` junto a los componentes y en `test/`. Los e2e
// (`e2e/*.spec.ts`) son de Playwright y no entran acá.
export default defineConfig({
  test: {
    include: ["components/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
  },
});
