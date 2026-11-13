import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * R8-3 · El seed que usa `pnpm e2e:local:prepare`: base vacía → migraciones → `db:seed` con
 * SEED_FIXTURES=example y el usuario de e2e. Comprueba que sale con datos de EJEMPLO (el log lo
 * dice) y que el usuario de e2e existe, con contraseña, y es admin. Datos inventados.
 */
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const E2E_EMAIL = "mauro@job-search-os.local";

let container: StartedPostgreSqlContainer | undefined;
let owner: Sql;
let ownerUrl: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
    .withDatabase("jobsearch")
    .withUsername("postgres")
    .withPassword("postgres")
    .start();
  ownerUrl = container.getConnectionUri();
  await applyMigrations(ownerUrl, { log: () => {} });
  owner = postgres(ownerUrl, { max: 1, prepare: false });
}, 180_000);

afterAll(async () => {
  await owner?.end();
  await container?.stop();
});

describe("seed de ejemplo para e2e", () => {
  it("siembra el usuario de e2e sin leer fixtures-private", async () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/seed.ts", "--local"], {
      cwd: PKG_ROOT,
      encoding: "utf8",
      timeout: 120_000,
      env: {
        ...process.env,
        DB_TARGET: "local",
        DATABASE_URL_LOCAL: ownerUrl,
        SEED_FIXTURES: "example",
        SEED_USER_EMAIL: E2E_EMAIL,
        SEED_USER_PASSWORD: "dev-password-local",
        ADMIN_EMAILS: E2E_EMAIL,
      },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("seeds de EJEMPLO");
    expect(r.stdout).toContain("SEED_FIXTURES=example");

    const users = await owner<{ email: string; password_hash: string | null }[]>`
      select email, password_hash from users where email = ${E2E_EMAIL}`;
    expect(users).toHaveLength(1);
    expect(users[0]?.password_hash).toBeTruthy();
    const admins = await owner<{ n: number }[]>`select count(*)::int as n from app_admins`;
    expect(admins[0]?.n).toBe(1);
  }, 150_000);
});
