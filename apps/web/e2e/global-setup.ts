// Import relativo directo: Playwright carga el globalSetup como CommonJS y el índice de
// @job-search-os/db arrastra módulos con import.meta. test-guard.ts no importa nada.
import { assertLocalTestDatabase, assertLocalTestEnv } from "../../../packages/db/src/test-guard";

/** Misma base por defecto que e2e/helpers.ts cuando no hay DATABASE_URL_LOCAL. */
const DEFAULT_LOCAL_DATABASE_URL = "postgres://postgres:postgres@localhost:54322/jobsearch";

/**
 * Guarda de los e2e (JS-121): los helpers insertan usuarios y borran datos, así que la base tiene
 * que ser local. Se valida antes de levantar el servidor y de correr ningún test.
 */
export default function globalSetup(): void {
  assertLocalTestDatabase(process.env.DATABASE_URL_LOCAL ?? DEFAULT_LOCAL_DATABASE_URL);
  assertLocalTestEnv();
}
