import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertLocalDatabaseUrl,
  assertLocalEnv,
  buildLocalEnv,
  E2E_EMAIL,
  specFilters,
} from "../../../../scripts/e2e-local.mjs";

/** R8-3 · scripts/e2e-local.mjs: la guarda de localhost, el entorno que arma y los filtros de specs. */
const SCRIPT = join(__dirname, "..", "..", "..", "..", "scripts", "e2e-local.mjs");
const NEON = "postgres://app:secreto@host-remoto/base";

describe("assertLocalDatabaseUrl", () => {
  it.each([
    "postgres://postgres:postgres@localhost:54322/jobsearch",
    "postgresql://u:p@127.0.0.1:5432/db",
    "postgres://u:p@[::1]:5432/db",
  ])("acepta %s", (url) => {
    expect(() => assertLocalDatabaseUrl(url)).not.toThrow();
  });

  it.each([
    NEON,
    "postgres://u:p@otro-host:5432/x",
    "postgres://u:p@remoto,@localhost/x",
    "postgres://u:p@@remoto@localhost/x",
    "postgres://u:p@localhost#@remoto/x",
    "http://localhost:5432/x",
    "no es una url",
    "",
  ])("rechaza %s", (url) => {
    expect(() => assertLocalDatabaseUrl(url)).toThrow();
  });

  it("no imprime la URL en el error", () => {
    expect(() => assertLocalDatabaseUrl(NEON)).toThrow(/no es local/);
    try {
      assertLocalDatabaseUrl(NEON);
    } catch (e) {
      expect((e as Error).message).not.toContain("secreto");
    }
  });
});

describe("assertLocalEnv", () => {
  it("corta si una variable de base apunta afuera, aunque se llame distinto", () => {
    expect(() => assertLocalEnv({ DATABASE_URL: NEON })).toThrow(/DATABASE_URL/);
    expect(() => assertLocalEnv({ OTRA_URL: NEON })).toThrow(/OTRA_URL/);
    expect(() => assertLocalEnv({ PGHOST: "otro-host" })).toThrow(/PGHOST/);
  });

  it("deja pasar un entorno sin bases o con bases locales", () => {
    expect(() => assertLocalEnv({ PATH: "/bin" })).not.toThrow();
    expect(() =>
      assertLocalEnv({ DATABASE_URL_LOCAL: "postgres://u:p@localhost:54322/jobsearch" }),
    ).not.toThrow();
  });
});

describe("buildLocalEnv", () => {
  it("fija destino local, datos de ejemplo, usuario de e2e y modo demo", () => {
    const env = buildLocalEnv({ PATH: "/bin", CONFIRM_PRODUCTION: "si", CI: "1" });
    expect(env.DB_TARGET).toBe("local");
    expect(env.SEED_FIXTURES).toBe("example");
    expect(env.LLM_DEMO).toBe("1");
    expect(env.SEED_USER_EMAIL).toBe(E2E_EMAIL);
    expect(env.E2E_EMAIL).toBe(E2E_EMAIL);
    expect(env.CONFIRM_PRODUCTION).toBeUndefined();
    expect(env.CI).toBeUndefined();
    expect(env.DATABASE_URL_LOCAL).toContain("localhost:54322");
    expect(env.DATABASE_URL_APP_LOCAL).toContain("localhost:54322");
  });

  it("pisa SEED_FIXTURES aunque venga otro valor", () => {
    expect(buildLocalEnv({ SEED_FIXTURES: "" }).SEED_FIXTURES).toBe("example");
  });

  it("falla cerrado con una base remota en el entorno, sin tocar nada", () => {
    expect(() => buildLocalEnv({ DATABASE_URL: NEON })).toThrow(/no es local/);
    expect(() => buildLocalEnv({ DATABASE_URL_LOCAL: NEON })).toThrow(/no es local/);
    expect(() => buildLocalEnv({ DATABASE_URL_APP_LOCAL: NEON })).toThrow(/no es local/);
  });
});

describe("specFilters", () => {
  it("convierte números en el prefijo del archivo, sin confundir 20 con 120", () => {
    const [f] = specFilters(["20"]);
    const re = new RegExp(f!);
    expect(re.test("e2e/20-recurso-ajeno.spec.ts")).toBe(true);
    expect(re.test("e2e\\20-recurso-ajeno.spec.ts")).toBe(true);
    expect(re.test("e2e/120-comparar-referencias.spec.ts")).toBe(false);
  });

  it("deja pasar nombres y rechaza lo que no es nombre ni número", () => {
    expect(specFilters(["login", "126"])).toEqual(["login", "[^0-9]126-"]);
    expect(() => specFilters(["--project=x"])).toThrow(/no válido/);
    expect(() => specFilters(["a b"])).toThrow(/no válido/);
    expect(() => specFilters(["x;y"])).toThrow(/no válido/);
  });
});

describe("e2e-local.mjs como comando", () => {
  it("con una base remota en el entorno sale con error antes de lanzar nada", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "prepare"], {
      env: { PATH: process.env.PATH, DATABASE_URL: NEON },
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no es local");
    expect(r.stderr).not.toContain("secreto");
  });

  it("rechaza un modo desconocido", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "otra"], {
      env: { PATH: process.env.PATH },
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
  });
});
