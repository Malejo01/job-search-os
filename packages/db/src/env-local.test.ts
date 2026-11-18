import { afterEach, describe, expect, it, vi } from "vitest";
import { localDatabaseUrl, resolveDatabaseUrl } from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("localDatabaseUrl", () => {
  it("sin variable usa el valor por defecto del entorno de pruebas", () => {
    expect(localDatabaseUrl({})).toBe("postgres://postgres:postgres@localhost:54322/jobsearch");
  });

  it("toma la contraseña del entorno y la codifica", () => {
    const url = new URL(localDatabaseUrl({ JSO_LOCAL_DB_PASSWORD: "clave con/raros@1" }));

    expect(decodeURIComponent(url.password)).toBe("clave con/raros@1");
    expect(url.hostname).toBe("localhost");
    expect(url.port).toBe("54322");
  });

  it("una variable vacía cuenta como ausente", () => {
    expect(localDatabaseUrl({ JSO_LOCAL_DB_PASSWORD: "  " })).toContain("postgres:postgres@");
  });
});

describe("resolveDatabaseUrl en local", () => {
  it("usa la contraseña del entorno", () => {
    vi.stubEnv("DATABASE_URL_LOCAL", "");
    vi.stubEnv("JSO_LOCAL_DB_PASSWORD", "clave-local-de-prueba");

    const url = resolveDatabaseUrl({ purpose: "migration", target: "local" });

    expect(url).toContain("postgres:clave-local-de-prueba@localhost:54322");
  });

  it("DATABASE_URL_LOCAL sigue teniendo prioridad", () => {
    vi.stubEnv("DATABASE_URL_LOCAL", "postgres://u:p@localhost:5999/otra");

    expect(resolveDatabaseUrl({ purpose: "migration", target: "local" })).toBe(
      "postgres://u:p@localhost:5999/otra",
    );
  });
});
