import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb } from "@job-search-os/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { purgeStaleCvDrafts } from "./cv-drafts";

/**
 * Limpieza de borradores del CV (R33-02): se borra solo lo que lleva 30 días o más sin uso, de todas las
 * personas, sin tocar lo reciente. Datos inventados.
 */
const NOW = new Date("2026-12-10T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (daysAgo: number): string => new Date(NOW.getTime() - daysAgo * DAY).toISOString();
const A = "e3300000-0000-4000-8000-0000000000a1";
const B = "e3300000-0000-4000-8000-0000000000b2";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

const count = async (): Promise<number> => {
  const rows = (await conn.db.execute(
    sql`select count(*)::int as n from cv_drafts where user_id in (${A}::uuid, ${B}::uuid)`,
  )) as unknown as { n: number }[];
  return rows[0]?.n ?? 0;
};

async function put(userId: string, kind: "chat" | "coach", daysAgo: number): Promise<void> {
  await conn.db.execute(sql`
    insert into cv_drafts (user_id, kind, payload, updated_at)
    values (${userId}::uuid, ${kind}, '{"v":1}'::jsonb, ${at(daysAgo)}::timestamptz)
    on conflict (user_id, kind) do update set updated_at = excluded.updated_at`);
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
  conn = createDb(ownerUrl, { max: 4 });
  for (const id of [A, B]) {
    await conn.db.execute(sql`insert into users (id, email, name)
      values (${id}::uuid, ${`${id.slice(-4)}@ejemplo.test`}, 'Ficticio') on conflict (id) do nothing`);
  }
}, 180_000);

afterAll(async () => {
  if (conn) {
    await conn.db.execute(sql`delete from users where id in (${A}::uuid, ${B}::uuid)`);
    await conn.close();
  }
  await container?.stop();
});

describe("purgeStaleCvDrafts", () => {
  it("borra los de 30 días o más y deja los recientes, de las dos personas", async () => {
    await put(A, "chat", 31);
    await put(A, "coach", 29);
    await put(B, "chat", 30);
    await put(B, "coach", 1);
    expect(await count()).toBe(4);

    expect(await purgeStaleCvDrafts(conn.db, { now: () => NOW })).toBe(2);

    const left = (await conn.db.execute(
      sql`select user_id::text as u, kind from cv_drafts where user_id in (${A}::uuid, ${B}::uuid) order by 1, 2`,
    )) as unknown as { u: string; kind: string }[];
    expect(left).toEqual([
      { u: A, kind: "coach" },
      { u: B, kind: "coach" },
    ]);
  });

  it("volver a correrla no borra nada más", async () => {
    expect(await purgeStaleCvDrafts(conn.db, { now: () => NOW })).toBe(0);
    expect(await count()).toBe(2);
  });

  it("un borrador que se retoma (se guarda de nuevo) arranca otra vez los 30 días", async () => {
    await put(A, "chat", 45);
    await put(A, "chat", 2); // se volvió a guardar hace 2 días
    expect(await purgeStaleCvDrafts(conn.db, { now: () => NOW })).toBe(0);
    expect(await count()).toBe(3);
  });

  it("borra en lotes hasta vaciar lo vencido", async () => {
    await conn.db.execute(sql`delete from cv_drafts where user_id in (${A}::uuid, ${B}::uuid)`);
    await put(A, "chat", 40);
    await put(A, "coach", 40);
    await put(B, "chat", 40);
    expect(await purgeStaleCvDrafts(conn.db, { now: () => NOW, batchSize: 1 })).toBe(3);
    expect(await count()).toBe(0);
  });
});
