import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * R7-4 · Cobertura de RLS. Recorre el catálogo de Postgres (no una lista a mano) y falla si alguna
 * tabla de `public` con columna `user_id` no tiene RLS activo, FORCE y al menos una policy. Así una
 * tabla nueva sin policy rompe este test en el mismo PR que la crea (regla de CLAUDE.md, ADR-002).
 *
 * Entornos: CI con DATABASE_URL (servicio postgres) o Testcontainer pgvector/pgvector:pg16 en local.
 */

/**
 * Tablas con `user_id` que quedan fuera de la regla. Cada una con su motivo. Hoy está vacía a propósito:
 * agregar una acá es una decisión de seguridad que se revisa en el PR, no un atajo para que pase el test.
 * Formato: { tabla: "motivo" }.
 */
const EXCEPCIONES_USER_ID: Record<string, string> = {};

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;

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
}, 180_000);

afterAll(async () => {
  await owner?.end();
  await container?.stop();
});

type Cobertura = {
  tabla: string;
  rls: boolean;
  force: boolean;
  policies: number;
  /** Policies de lectura sin condición real (USING true) abiertas a los roles de la app: dejarían ver todas las filas. */
  abiertas: number;
};

async function coberturaPorTabla(): Promise<Cobertura[]> {
  return owner<Cobertura[]>`
    select c.relname as tabla,
           c.relrowsecurity as rls,
           c.relforcerowsecurity as force,
           (select count(*)::int from pg_policies p
             where p.schemaname = 'public' and p.tablename = c.relname) as policies,
           (select count(*)::int from pg_policies p
             where p.schemaname = 'public' and p.tablename = c.relname
               and p.cmd in ('ALL', 'SELECT')
               -- Las policies *_definer_* (USING true) son solo para el dueño, que es quien corre las funciones
               -- SECURITY DEFINER: no cuentan. Importa que no estén abiertas para los roles de la app.
               and p.roles && array['public', 'authenticated', 'jobsearch_app']::name[]
               and coalesce(p.qual, 'true') in ('true', '(true)')) as abiertas
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind in ('r', 'p')
      and exists (
        select 1 from information_schema.columns col
        where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'user_id'
      )
    order by c.relname`;
}

describe("cobertura de RLS por catálogo (R7-4)", () => {
  it("el recorrido encuentra tablas (si no, el test no estaría midiendo nada)", async () => {
    const tablas = (await coberturaPorTabla()).map((t) => t.tabla);
    expect(tablas.length).toBeGreaterThan(10);
    expect(tablas).toContain("jobs");
  });

  it("toda tabla con user_id tiene RLS activo, FORCE y al menos una policy", async () => {
    const filas = (await coberturaPorTabla()).filter((t) => !(t.tabla in EXCEPCIONES_USER_ID));
    const sinRls = filas.filter((t) => !t.rls).map((t) => t.tabla);
    const sinForce = filas.filter((t) => !t.force).map((t) => t.tabla);
    const sinPolicy = filas.filter((t) => t.policies === 0).map((t) => t.tabla);
    expect({ sinRls, sinForce, sinPolicy }).toEqual({ sinRls: [], sinForce: [], sinPolicy: [] });
  });

  it("ninguna tabla con user_id tiene una policy de lectura abierta (USING true) para los roles de la app", async () => {
    const filas = (await coberturaPorTabla()).filter((t) => !(t.tabla in EXCEPCIONES_USER_ID));
    expect(filas.filter((t) => t.abiertas > 0).map((t) => t.tabla)).toEqual([]);
  });

  it("las excepciones declaradas existen y tienen motivo (la lista no se pudre)", async () => {
    const tablas = new Set((await coberturaPorTabla()).map((t) => t.tabla));
    for (const [tabla, motivo] of Object.entries(EXCEPCIONES_USER_ID)) {
      expect(tablas.has(tabla), `la excepción ${tabla} ya no es una tabla con user_id`).toBe(true);
      expect(motivo.trim().length).toBeGreaterThan(10);
    }
  });
});
