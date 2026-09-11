import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.integration.config";

/** Mismo test de integración, contra la nube: dueño por DATABASE_URL_UNPOOLED y app por DATABASE_URL_APP. */
export default mergeConfig(
  base,
  defineConfig({
    test: { env: { TEST_DB_TARGET: "cloud" } },
  }),
);
