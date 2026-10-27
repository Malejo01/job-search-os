import { expect, test } from "@playwright/test";
import { ownerDb } from "./helpers";

/**
 * Guarda de la conexión de dueño (JS-128): `ownerDb()` valida el host con la misma guarda que los
 * tests de integración antes de crear el cliente de postgres. Sin página ni base: la guarda corre
 * de forma síncrona, así que si lanza no se llegó a crear la conexión. global-setup ya validó el
 * entorno real; acá se cambia DATABASE_URL_LOCAL solo dentro de cada test y se restaura al final,
 * porque los demás specs dependen de ella.
 */
const ORIGINAL = process.env.DATABASE_URL_LOCAL;

function restoreEnv(): void {
  // Asignar undefined dejaría el string "undefined": si no estaba, se borra
  if (ORIGINAL === undefined) delete process.env.DATABASE_URL_LOCAL;
  else process.env.DATABASE_URL_LOCAL = ORIGINAL;
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
