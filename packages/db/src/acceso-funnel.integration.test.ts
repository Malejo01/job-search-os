import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Embudo de /acceso (C8-2) por el camino real: la app como jobsearch_app. Suma sin sesión por
 * acceso_funnel_hit() y lee solo un admin por acceso_funnel_admin(). Sin datos de personas.
 */
const APP_PASSWORD = "jobsearch_app_test";
const ADMIN_ID = "d9000000-0000-4000-8000-0000000008a1";
const PLAIN_ID = "d9000000-0000-4000-8000-0000000008a2";

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function hit(origin: string, step: string, role: string | null = null): Promise<void> {
  await app`select acceso_funnel_hit(${origin}, ${step}, ${role})`;
}

async function asUser<T>(userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}

beforeAll(async () => {
  let ownerUrl: string;
  if (process.env.DATABASE_URL) {
    ownerUrl = process.env.DATABASE_URL;
  } else {
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
  app = postgres(u.toString(), { max: 2, prepare: false });
  await owner`insert into users (id, email, name) values
    (${ADMIN_ID}, 'admin-embudo@ejemplo.test', 'Admin Ficticio'),
    (${PLAIN_ID}, 'comun-embudo@ejemplo.test', 'Comun Ficticio')
    on conflict (id) do nothing`;
  await owner`insert into app_admins (user_id) values (${ADMIN_ID}) on conflict do nothing`;
}, 180_000);

beforeEach(async () => {
  await owner`delete from acceso_funnel`;
});

afterAll(async () => {
  if (owner) {
    await owner`delete from acceso_funnel`;
    await owner`delete from users where id in (${ADMIN_ID}, ${PLAIN_ID})`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("embudo de /acceso (C8-2)", () => {
  it("la tabla tiene RLS y la app no la lee ni la escribe directo", async () => {
    const [row] =
      await owner`select relrowsecurity as rls from pg_class where relname = 'acceso_funnel'`;
    expect(row?.rls).toBe(true);
    await expect(app`select * from acceso_funnel`).rejects.toThrow(/permission denied/);
    await expect(
      app`insert into acceso_funnel (hour, origin, step) values (now(), 'directo', 'visita')`,
    ).rejects.toThrow(/permission denied/);
  });

  it("suma en la misma fila por hora, origen, paso y carrera", async () => {
    await hit("voces-jovenes", "visita");
    await hit("voces-jovenes", "visita");
    await hit("voces-jovenes", "enviado", "abogacia");
    await hit("directo", "visita");
    const rows = await owner<{ origin: string; step: string; role: string; count: number }[]>`
      select origin, step, role, count from acceso_funnel order by origin, step`;
    expect(rows).toEqual([
      { origin: "directo", step: "visita", role: "", count: 1 },
      { origin: "voces-jovenes", step: "enviado", role: "abogacia", count: 1 },
      { origin: "voces-jovenes", step: "visita", role: "", count: 2 },
    ]);
  });

  it("la carrera solo queda en `carrera` y `enviado`", async () => {
    await hit("directo", "visita", "abogacia");
    const [row] = await owner<{ role: string }[]>`select role from acceso_funnel`;
    expect(row?.role).toBe("");
  });

  it("rechaza origen, paso o carrera fuera de forma (sin texto libre)", async () => {
    await expect(hit("Mi Email@x.com", "visita")).rejects.toThrow(/origen inválido/);
    await expect(hit("directo", "borrar")).rejects.toThrow(/paso inválido/);
    await expect(hit("directo", "enviado", "DROP TABLE")).rejects.toThrow(/carrera inválida/);
  });

  it("solo un admin de la base lee los agregados", async () => {
    await hit("voces-jovenes", "visita");
    const rows = await asUser(ADMIN_ID, (tx) => tx`select * from acceso_funnel_admin(30)`);
    expect(rows).toHaveLength(1);
    await expect(
      asUser(PLAIN_ID, (tx) => tx`select * from acceso_funnel_admin(30)`),
    ).rejects.toThrow(/no autorizado/);
  });
});
