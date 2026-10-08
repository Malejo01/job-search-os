import { describe, expect, it } from "vitest";
import { assertLocalTestDatabase, assertLocalTestEnv } from "./test-guard";

describe("assertLocalTestDatabase", () => {
  it("rechaza una URL remota", () => {
    expect(() => assertLocalTestDatabase("postgres://u:p@db.remoto.example/db")).toThrow(/Guarda/);
  });

  it("no imprime la contraseña en el error", () => {
    try {
      assertLocalTestDatabase("postgres://u:secreto-x@db.remoto.example/db");
    } catch (e) {
      expect((e as Error).message).not.toContain("secreto-x");
    }
  });

  it("acepta localhost, 127.0.0.1 y ::1", () => {
    expect(() => assertLocalTestDatabase("postgres://u:p@localhost:5432/db")).not.toThrow();
    expect(() => assertLocalTestDatabase("postgres://u:p@127.0.0.1:55001/db")).not.toThrow();
    expect(() => assertLocalTestDatabase("postgres://u:p@[::1]:5432/db")).not.toThrow();
  });

  it("rechaza un host que solo empieza con localhost", () => {
    expect(() => assertLocalTestDatabase("postgres://u:p@localhost.remoto.example/db")).toThrow();
  });

  it("rechaza una URL inválida o ausente", () => {
    expect(() => assertLocalTestDatabase("no es una url")).toThrow(/no es válida/);
    expect(() => assertLocalTestDatabase(undefined)).toThrow(/no es válida/);
  });
});

describe("assertLocalTestEnv", () => {
  it("falla si cualquier variable con URL de Postgres es remota", () => {
    expect(() =>
      assertLocalTestEnv({
        DATABASE_URL: "postgres://u:p@localhost:5432/db",
        DATABASE_URL_APP: "postgresql://u:p@db.remoto.example/db",
      }),
    ).toThrow(/DATABASE_URL_APP/);
  });

  it("pasa con URL locales y variables que no son URL", () => {
    expect(() =>
      assertLocalTestEnv({ DATABASE_URL: "postgres://u:p@localhost:5432/db", OTRA: "x" }),
    ).not.toThrow();
  });

  it("detecta una URL remota con espacio inicial", () => {
    expect(() =>
      assertLocalTestEnv({ DATABASE_URL: " postgres://u:p@db.remoto.example/db" }),
    ).toThrow();
    expect(() => assertLocalTestEnv({ OTRA: "  postgres://u:p@db.remoto.example/db" })).toThrow();
  });

  it("valida por nombre: *_URL con postgres y PGHOST", () => {
    expect(() =>
      assertLocalTestEnv({ MI_BASE_URL: "Postgres://u:p@db.remoto.example/db" }),
    ).toThrow();
    expect(() => assertLocalTestEnv({ PGHOST: "db.remoto.example" })).toThrow(/PGHOST/);
    expect(() => assertLocalTestEnv({ PGHOST: " localhost " })).not.toThrow();
  });

  it("no permite el modo nube", () => {
    expect(() => assertLocalTestEnv({ TEST_DB_TARGET: "cloud" })).toThrow(/nube/);
  });
});
