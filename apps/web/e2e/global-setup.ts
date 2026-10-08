import { LOCAL_DATABASE_URL, assertLocalTestDatabase, assertLocalTestEnv } from "@job-search-os/db";

/**
 * Guarda de los e2e (JS-121): los helpers insertan usuarios y borran datos, así que la base tiene
 * que ser local. Se valida antes de levantar el servidor y de correr ningún test.
 */
export default function globalSetup(): void {
  assertLocalTestDatabase(process.env.DATABASE_URL_LOCAL ?? LOCAL_DATABASE_URL);
  assertLocalTestEnv();
}
