import { expect, test } from "@playwright/test";
import { localChildEnv, ownerDb, runDemoWorker } from "./helpers";
import { computeRoleMarketAndPlan, newRun } from "./personas/flow";

/**
 * Guarda de la conexión de dueño (JS-128): `ownerDb()` valida el host con la misma guarda que los
 * tests de integración antes de crear el cliente de postgres. Sin página ni base: la guarda corre
 * de forma síncrona, así que si lanza no se llegó a crear la conexión. global-setup ya validó el
 * entorno real; acá se cambian las variables de base solo dentro de cada test y se restauran al
 * final, porque los demás specs dependen de ellas.
 *
 * N4-3: lo mismo para los helpers que lanzan procesos hijos (`runDemoWorker`,
 * `computeRoleMarketAndPlan`), vía `localChildEnv`.
 */
const TOUCHED = ["DATABASE_URL_LOCAL", "DATABASE_URL_APP_LOCAL", "DATABASE_URL", "PGHOST"] as const;
const ORIGINAL = Object.fromEntries(TOUCHED.map((name) => [name, process.env[name]]));

function restoreEnv(): void {
  for (const name of TOUCHED) {
    // Asignar undefined dejaría el string "undefined": si no estaba, se borra
    if (ORIGINAL[name] === undefined) delete process.env[name];
    else process.env[name] = ORIGINAL[name];
  }
}

test.describe("guarda de ownerDb (JS-128)", () => {
  test.afterEach(restoreEnv);

  // URLs inventadas: ninguna apunta a una base real
  const REMOTE_URLS = [
    "postgres://u:p@db.ejemplo.test:5432/x",
    "postgresql://u:p@10.0.0.5/x",
    "  postgres://u:p@ep-ejemplo.neon.example/x?sslmode=require",
  ];

  for (const url of REMOTE_URLS) {
    test(`con una URL remota (${url.trim().split("@")[1]}) falla antes de conectarse`, () => {
      process.env.DATABASE_URL_LOCAL = url;
      // Lanza de forma síncrona: postgres() nunca se llama y no hay cliente que cerrar
      expect(() => ownerDb()).toThrow(/Guarda de tests/);
    });
  }

  test("con una URL que no se puede leer también falla", () => {
    process.env.DATABASE_URL_LOCAL = "no-es-una-url";
    expect(() => ownerDb()).toThrow(/Guarda de tests/);
  });

  test("con la URL local por defecto no lanza", async () => {
    delete process.env.DATABASE_URL_LOCAL;
    // El cliente de postgres es perezoso: sin consultas no abre conexión, y close() lo libera
    const { close } = ownerDb();
    await close();
  });

  test("con 127.0.0.1 explícito no lanza", async () => {
    process.env.DATABASE_URL_LOCAL = "postgres://u:p@127.0.0.1:5432/x";
    const { close } = ownerDb();
    await close();
  });
});

test.describe("guarda de los procesos hijos (N4-3)", () => {
  test.afterEach(restoreEnv);

  // Host inventado que no resuelve: si la guarda faltara, el hijo fallaría rápido por DNS en vez de
  // colgarse, y con otro mensaje («Command failed»), así que el test igual quedaría rojo. Solo los
  // casos con DATABASE_URL_LOCAL remota llaman a los helpers: con las otras variables el hijo
  // correría de verdad contra la base local, así que ahí se prueba `localChildEnv`, que es lo que
  // los dos helpers evalúan antes de execSync.
  const REMOTE = "postgres://u:p@db.ejemplo.test:5432/x";

  /**
   * La guarda lanza antes de execSync: el mensaje empieza con «Guarda de tests». Si el hijo se
   * hubiera lanzado, el error sería el de execSync («Command failed: ...»), que no la menciona.
   */
  const GUARD_FIRST = /^Guarda de tests/;

  test("DATABASE_URL_LOCAL remota: runDemoWorker lanza sin crear el hijo", () => {
    process.env.DATABASE_URL_LOCAL = REMOTE;
    expect(() => localChildEnv()).toThrow(GUARD_FIRST);
    expect(() => runDemoWorker()).toThrow(GUARD_FIRST);
  });

  test("DATABASE_URL_APP_LOCAL remota: lanza", () => {
    process.env.DATABASE_URL_APP_LOCAL = "postgresql://u:p@10.0.0.5/x";
    expect(() => localChildEnv()).toThrow(GUARD_FIRST);
  });

  test("DATABASE_URL_LOCAL ilegible: lanza aunque no tenga forma de URL de Postgres", () => {
    process.env.DATABASE_URL_LOCAL = "no-es-una-url";
    expect(() => localChildEnv()).toThrow(GUARD_FIRST);
  });

  test("DATABASE_URL remota heredada del entorno: lanza", () => {
    process.env.DATABASE_URL = "  postgres://u:p@ep-ejemplo.neon.example/x?sslmode=require";
    expect(() => localChildEnv()).toThrow(/Guarda de tests.*\(variable DATABASE_URL\)/);
  });

  test("PGHOST remoto: lanza", () => {
    process.env.PGHOST = "db.ejemplo.test";
    expect(() => localChildEnv()).toThrow(/Guarda de tests.*\(variable PGHOST\)/);
  });

  test("una URL remota en `extra` tampoco pasa", () => {
    expect(() => localChildEnv({ DATABASE_URL: REMOTE })).toThrow(GUARD_FIRST);
  });

  test("computeRoleMarketAndPlan con URL remota lanza sin crear el hijo", () => {
    process.env.DATABASE_URL_LOCAL = REMOTE;
    const run = { ...newRun("lucia"), userId: "a0000000-0000-4000-8000-0000000000ff" };
    expect(() => computeRoleMarketAndPlan(run)).toThrow(GUARD_FIRST);
    expect(() => computeRoleMarketAndPlan(run, { rebuildOnly: true })).toThrow(GUARD_FIRST);
  });

  test("con los defaults locales no lanza y fija las URLs validadas", () => {
    delete process.env.DATABASE_URL_LOCAL;
    delete process.env.DATABASE_URL_APP_LOCAL;
    delete process.env.DATABASE_URL;
    delete process.env.PGHOST;
    const env = localChildEnv({ LOG_LEVEL: "warn" });
    expect(env.DB_TARGET).toBe("local");
    expect(env.DATABASE_URL_LOCAL).toBe("postgres://postgres:postgres@localhost:54322/jobsearch");
    expect(env.DATABASE_URL_APP_LOCAL).toBe(
      "postgres://jobsearch_app:jobsearch_app@localhost:54322/jobsearch",
    );
    expect(env.LOG_LEVEL).toBe("warn");
  });

  test("las URLs locales del entorno (las del CI) pasan tal cual al hijo", () => {
    process.env.DATABASE_URL_LOCAL = "postgres://postgres:postgres@localhost:5432/postgres";
    process.env.DATABASE_URL_APP_LOCAL =
      "postgres://jobsearch_app:jobsearch_app@localhost:5432/postgres";
    // `extra` no puede cambiar la base del hijo: las fijadas ganan
    const env = localChildEnv({ DB_TARGET: "cloud" });
    expect(env.DB_TARGET).toBe("local");
    expect(env.DATABASE_URL_LOCAL).toBe(process.env.DATABASE_URL_LOCAL);
    expect(env.DATABASE_URL_APP_LOCAL).toBe(process.env.DATABASE_URL_APP_LOCAL);
  });
});
