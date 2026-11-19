import { createHash } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "./client";
import { applyMigrations } from "./migrate";

/**
 * «Cerrar todas las sesiones» por el camino real: corre `closeAllSessions` de la app contra la base, conectada
 * como jobsearch_app (NOBYPASSRLS) y con el contexto de usuario de `withUser`. Datos inventados.
 */
const A = "a9300000-0000-4000-8000-000000000001";
const B = "b9300000-0000-4000-8000-000000000002";
const APP_PASSWORD = "jobsearch_app_test";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const MCP_A = sha("token-mcp-de-prueba-a");
const MCP_B = sha("token-mcp-de-prueba-b");
const RESET_A = sha("reset-de-prueba-a");
const RESET_B = sha("reset-de-prueba-b");

const holder = vi.hoisted(() => ({ db: undefined as unknown }));

// closeAllSessions importa ./db de la app: acá se reemplaza por la misma lógica de withUser sobre esta base.
vi.mock("../../../apps/web/lib/db", () => ({
  withUser: async (userId: string, fn: (tx: unknown) => Promise<unknown>) => {
    const db = holder.db as {
      transaction: (f: (tx: { execute: (q: unknown) => Promise<unknown> }) => Promise<unknown>) => Promise<unknown>;
    };
    const { sql: dsql } = await import("drizzle-orm");
    return db.transaction(async (tx) => {
      await tx.execute(dsql`select set_config('app.user_id', ${userId}, true)`);
      return fn(tx);
    });
  },
}));

let container: StartedPostgreSqlContainer | undefined;
let owner: Sql;
let app: Sql;
let closeAllSessions: (userId: string) => Promise<void>;

async function mcpOwner(hash: string): Promise<{ user_id: string }[]> {
  return app<{ user_id: string }[]>`select user_id from mcp_token_user(${hash})`;
}

async function resetUsedAt(hash: string): Promise<Date | null> {
  const [row] = await app<{ used_at: Date | null }[]>`select used_at from check_reset_token(${hash})`;
  return row!.used_at;
}

async function sessionVersion(id: string): Promise<number> {
  const [row] = await owner<{ v: number }[]>`select session_version as v from users where id = ${id}`;
  return row!.v;
}

beforeAll(async () => {
  let ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
      .withDatabase("jobsearch")
      .withUsername("postgres")
      .withPassword("postgres")
      .start();
    ownerUrl = container.getConnectionUri();
  }
  await applyMigrations(ownerUrl, { log: () => {} });
  owner = postgres(ownerUrl, { max: 1, prepare: false });
  await owner.unsafe(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`);
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  app = postgres(u.toString(), { max: 4, prepare: false });
  holder.db = createDb(u.toString(), { max: 4 }).db;

  await owner`insert into users (id, email, password_hash) values (${A}, 'cerrar-a@example.com', 'x')`;
  await owner`insert into users (id, email, password_hash) values (${B}, 'cerrar-b@example.com', 'x')`;
  for (const [id, mcp, reset] of [
    [A, MCP_A, RESET_A],
    [B, MCP_B, RESET_B],
  ] as const) {
    await owner`insert into mcp_tokens (user_id, token_hash, label, expires_at)
                values (${id}, ${mcp}, 'Chat de prueba', now() + interval '30 days')`;
    await owner`insert into password_reset_tokens (user_id, token_hash, expires_at)
                values (${id}, ${reset}, now() + interval '1 hour')`;
  }
  ({ closeAllSessions } = await import("../../../apps/web/lib/close-sessions"));
}, 180_000);

afterAll(async () => {
  await owner`delete from mcp_tokens where user_id in ${owner([A, B])}`.catch(() => undefined);
  await owner`delete from password_reset_tokens where user_id in ${owner([A, B])}`.catch(() => undefined);
  await owner`delete from users where id in ${owner([A, B])}`.catch(() => undefined);
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("closeAllSessions", () => {
  it("revoca los tokens MCP y vence los links de reset de esa persona, y no los de otra", async () => {
    expect(await mcpOwner(MCP_A)).toHaveLength(1);
    expect(await resetUsedAt(RESET_A)).toBeNull();
    const before = await sessionVersion(A);

    await closeAllSessions(A);

    expect(await sessionVersion(A)).toBe(before + 1);
    expect(await mcpOwner(MCP_A)).toHaveLength(0);
    expect(await resetUsedAt(RESET_A)).not.toBeNull();
    expect(await mcpOwner(MCP_B)).toHaveLength(1);
    expect(await resetUsedAt(RESET_B)).toBeNull();
    expect(await sessionVersion(B)).toBe(0);
  });
});
