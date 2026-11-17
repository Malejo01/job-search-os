import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * career_history (C-25, CVC-0, rls/0014) por el camino real: la app como jobsearch_app. La persona
 * lee, inserta, edita y borra lo suyo; no ve ni toca lo de otra. Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";
const A = "c2500000-0000-4000-8000-000000000001";
const B = "c2500000-0000-4000-8000-000000000002";
const ALL = [A, B];

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function asUser<T>(userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}

type Row = {
  kind?: string;
  organization?: string;
  title?: string;
  start?: string;
  end?: string;
  bullets?: string[];
  link?: string | null;
};

const insertAs = (userId: string, ownerOfRow: string, extra: Row = {}) =>
  asUser(userId, (tx) => {
    const row = { kind: "trabajo", organization: "Empresa A", title: "Cargo Ficticio", ...extra };
    return tx`insert into career_history (user_id, kind, organization, title, start_month, end_month, bullets, link)
              values (${ownerOfRow}, ${row.kind}, ${row.organization}, ${row.title},
                      ${row.start ?? null}, ${row.end ?? null}, ${row.bullets ?? []}, ${row.link ?? null})`;
  });

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
  app = postgres(u.toString(), { max: 4, prepare: false });
  for (const id of ALL) {
    await owner`insert into users (id, email, name) values (${id}, ${`${id.slice(-4)}@ejemplo.test`}, 'Ficticio')
      on conflict (id) do nothing`;
  }
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from career_history where user_id in ${owner(ALL)}`;
    await owner`delete from users where id in ${owner(ALL)}`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("career_history (C-25)", () => {
  it("la persona inserta, lee, edita y borra lo suyo", async () => {
    await insertAs(A, A, { start: "2022-03", end: "2024-01", bullets: ["Viñeta ficticia"] });
    const mine = await asUser(A, (tx) => tx`select organization, bullets from career_history`);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.bullets).toEqual(["Viñeta ficticia"]);
    const upd = await asUser(A, (tx) => tx`update career_history set title = 'Otro cargo'`);
    expect(upd.count).toBe(1);
    const del = await asUser(A, (tx) => tx`delete from career_history`);
    expect(del.count).toBe(1);
  });

  it("otra persona no ve, no edita, no borra ni inserta a nombre ajeno", async () => {
    await insertAs(B, B);
    expect(await asUser(A, (tx) => tx`select 1 from career_history`)).toHaveLength(0);
    expect((await asUser(A, (tx) => tx`update career_history set title = 'x'`)).count).toBe(0);
    expect((await asUser(A, (tx) => tx`delete from career_history`)).count).toBe(0);
    await expect(insertAs(A, B)).rejects.toThrow(/row-level security/);
    const [n] = await owner`select count(*)::int as n from career_history where user_id = ${B}`;
    expect(n!.n).toBe(1);
  });

  it("sin contexto de usuario no se ve nada", async () => {
    expect(await app`select 1 from career_history`).toHaveLength(0);
  });

  it("los CHECK de forma rechazan datos fuera de rango", async () => {
    await expect(insertAs(A, A, { kind: "hobby" })).rejects.toThrow(/career_history_kind/);
    await expect(insertAs(A, A, { organization: "" })).rejects.toThrow(
      /career_history_organization_length/,
    );
    await expect(insertAs(A, A, { title: "x".repeat(121) })).rejects.toThrow(
      /career_history_title_length/,
    );
    await expect(insertAs(A, A, { start: "2022-13" })).rejects.toThrow(
      /career_history_start_month/,
    );
    await expect(insertAs(A, A, { end: "marzo 2024" })).rejects.toThrow(/career_history_end_month/);
    await expect(insertAs(A, A, { bullets: Array(7).fill("v") })).rejects.toThrow(
      /career_history_bullets/,
    );
  });

  it("proyectos (R12-4): la policy de rls/0014 cubre la columna `link` con dos personas", async () => {
    await owner`delete from career_history where user_id in ${owner(ALL)}`;
    const proyecto = {
      kind: "proyecto",
      organization: "Proyecto 1",
      title: "Rol ficticio",
      bullets: ["Armé el tablero", "Stack: React, Node.js"],
    };
    await insertAs(A, A, { ...proyecto, link: "https://ejemplo.test/proyecto-a" });
    await insertAs(B, B, { ...proyecto, link: "https://ejemplo.test/proyecto-b" });
    // cada una lee solo su link
    const mine = await asUser(A, (tx) => tx`select kind, link from career_history`);
    expect(mine).toEqual([{ kind: "proyecto", link: "https://ejemplo.test/proyecto-a" }]);
    const hits = await asUser(
      A,
      (tx) => tx`select 1 from career_history where link = 'https://ejemplo.test/proyecto-b'`,
    );
    expect(hits).toHaveLength(0);
    // A no puede cambiar ni borrar el link de B
    const upd = await asUser(
      A,
      (tx) =>
        tx`update career_history set link = 'https://ejemplo.test/robado' where user_id = ${B}`,
    );
    expect(upd.count).toBe(0);
    expect(
      (await asUser(A, (tx) => tx`update career_history set link = null where user_id = ${B}`))
        .count,
    ).toBe(0);
    // ni insertar un proyecto con link a nombre de B
    await expect(
      insertAs(A, B, { ...proyecto, link: "https://ejemplo.test/ajeno" }),
    ).rejects.toThrow(/row-level security/);
    const [b] = await owner`select link from career_history where user_id = ${B}`;
    expect(b!.link).toBe("https://ejemplo.test/proyecto-b");
    // la persona sí edita su propio link
    const own = await asUser(
      A,
      (tx) => tx`update career_history set link = 'https://ejemplo.test/nuevo' returning link`,
    );
    expect(own).toEqual([{ link: "https://ejemplo.test/nuevo" }]);
    // sin contexto de usuario no se ve ningún link
    expect(await app`select link from career_history`).toHaveLength(0);
    await owner`delete from career_history where user_id in ${owner(ALL)}`;
  });

  it("CHECK del link: https y hasta 200 caracteres; el tipo `proyecto` existe", async () => {
    await expect(
      insertAs(A, A, { kind: "proyecto", link: "http://ejemplo.test/x" }),
    ).rejects.toThrow(/career_history_link/);
    await expect(
      insertAs(A, A, { kind: "proyecto", link: "persona@ejemplo.test" }),
    ).rejects.toThrow(/career_history_link/);
    await expect(
      insertAs(A, A, { kind: "proyecto", link: `https://ejemplo.test/${"x".repeat(180)}` }),
    ).rejects.toThrow(/career_history_link/);
    await insertAs(A, A, { kind: "proyecto", link: `https://ejemplo.test/${"x".repeat(179)}` });
    await insertAs(A, A, { kind: "proyecto" });
    const rows = await asUser(A, (tx) => tx`select kind, link from career_history`);
    expect(rows.map((r) => r.kind)).toEqual(["proyecto", "proyecto"]);
    expect(rows.filter((r) => r.link === null)).toHaveLength(1);
    await owner`delete from career_history where user_id in ${owner(ALL)}`;
  });

  it("la tabla no tiene columnas de datos personales sensibles", async () => {
    const cols = await owner<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'career_history'`;
    const names = cols.map((c) => c.column_name);
    for (const banned of ["phone", "telefono", "photo", "foto", "birth", "document", "address"]) {
      expect(
        names.filter((n) => n.includes(banned)),
        banned,
      ).toEqual([]);
    }
  });
});
