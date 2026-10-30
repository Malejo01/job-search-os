import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { assertLocalTestDatabase, assertLocalTestEnv } from "./test-guard";

/**
 * URLs que la guarda vieja (WHATWG `new URL().hostname`, último `@`) daba por locales pero con las
 * que postgres.js arma una lista de hosts cuyo primero es remoto: toma lo que sigue al PRIMER `@`
 * hasta `/` o `?` (no corta en `#`) y lo parte por comas.
 */
const AMBIGUOUS_URLS: Array<[url: string, postgresJsHosts: string[]]> = [
  ["postgres://u:p@remoto.example,@localhost/x", ["remoto.example", "@localhost"]],
  ["postgres://u:p@remoto.example,x@localhost:5432/x", ["remoto.example", "x@localhost"]],
  ["postgres://u:p@localhost#,remoto.example/x", ["localhost#", "remoto.example"]],
];

const VALID_URLS = [
  "postgres://postgres:postgres@localhost:54322/jobsearch",
  "postgres://postgres:postgres@localhost:5432/postgres",
  "postgres://u:p@127.0.0.1:5432/x",
  // Pasa la guarda, pero postgres.js 3.4.9 no sabe usarlo: corta el host en ":" y queda "[", así que
  // la conexión falla cerrado (no llega a ningún lado). Se deja para no romper el caso documentado.
  "postgres://u:p@[::1]:5432/x",
  "POSTGRESQL://u:p@localhost:5432/x",
  "postgresql://u:p@LOCALHOST:5432/x",
  "postgres://u:p%40ss%2Cw%23rd@localhost:5432/x",
  "  postgres://u:p@localhost:5432/x  ",
  "postgres://u:p@localhost:5432/x?sslmode=disable",
  "postgres://u:p@localhost:5432/x#fragmento",
];

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

  describe("autoridad ambigua entre WHATWG y postgres.js", () => {
    // postgres() es perezoso: crear el cliente no abre conexiones; end() lo cierra igual
    const clients: postgres.Sql[] = [];
    afterAll(async () => {
      await Promise.all(clients.map((c) => c.end({ timeout: 0 })));
    });

    it.each(AMBIGUOUS_URLS)("rechaza %s", (url, expectedHosts) => {
      // Documenta la discrepancia: WHATWG ve localhost, postgres.js se conectaría primero al remoto
      expect(new URL(url).hostname).toBe("localhost");
      const sql = postgres(url);
      clients.push(sql);
      expect(sql.options.host).toEqual(expectedHosts);

      expect(() => assertLocalTestDatabase(url)).toThrow(/Guarda/);
      expect(() => assertLocalTestEnv({ DATABASE_URL: url })).toThrow(/DATABASE_URL/);
    });

    it("rechaza varios hosts aunque todos sean locales (multihost no se usa en tests)", () => {
      expect(() => assertLocalTestDatabase("postgres://u:p@localhost,127.0.0.1/x")).toThrow(
        /Guarda/,
      );
    });

    it("rechaza una coma url-encodeada en el host (postgres.js decodifica antes de partir)", () => {
      expect(() => assertLocalTestDatabase("postgres://u:p@remoto.example%2Clocalhost/x")).toThrow(
        /Guarda/,
      );
    });

    it("falla cerrado con un @ sin encodear en la contraseña (hay que usar %40)", () => {
      // Antes pasaba (WHATWG y postgres.js coinciden en localhost), pero más de un @ es ambiguo
      expect(() => assertLocalTestDatabase("postgres://u:p@ss@localhost/x")).toThrow(/Guarda/);
      expect(() => assertLocalTestDatabase("postgres://u:p%40ss@localhost/x")).not.toThrow();
    });

    it("rechaza # en la autoridad aunque no haya coma", () => {
      expect(() => assertLocalTestDatabase("postgres://u:p@localhost#x")).toThrow(/Guarda/);
    });

    it("no imprime la contraseña al rechazar una URL ambigua", () => {
      expect(() =>
        assertLocalTestDatabase("postgres://u:secreto-x@remoto.example,@localhost/x"),
      ).toThrow(expect.objectContaining({ message: expect.not.stringContaining("secreto-x") }));
    });

    it("la réplica de hosts de postgres.js rechaza lo que WHATWG y el chequeo crudo dejan pasar", () => {
      // WHATWG borra el tab y ve postgres://u:p@localhost/...; postgres.js no lo borra, toma el
      // SEGUNDO "://" (dentro de la query) y arma la autoridad "remote.example%2Clocalhost": sin
      // ",", "#" ni "@" crudos, pero decodificada es multihost con el remoto primero.
      const url = "postgres:\t//u:p@localhost/x?a=://remote.example%2Clocalhost/";
      expect(new URL(url).hostname).toBe("localhost");
      const sql = postgres(url);
      clients.push(sql);
      expect(sql.options.host).toEqual(["remote.example", "localhost"]);
      // El mensaje es el de host no local (no el de URL ambigua ni inválida): lo corta la réplica
      expect(() => assertLocalTestDatabase(url)).toThrow(/solo corren contra localhost/);
    });

    it("una coma encodeada en el host la corta WHATWG (hostname opaco con %2C)", () => {
      const url = "postgres://u:p@localhost%2Cremote.example/db";
      expect(new URL(url).hostname).toBe("localhost%2Cremote.example");
      const sql = postgres(url);
      clients.push(sql);
      expect(sql.options.host).toEqual(["localhost", "remote.example"]);
      expect(() => assertLocalTestDatabase(url)).toThrow(/solo corren contra localhost/);
    });

    it.each(VALID_URLS)("acepta %s", (url) => {
      expect(() => assertLocalTestDatabase(url)).not.toThrow();
    });
  });

  it.each([
    "pg://u:p@localhost/x",
    "http://localhost/x",
    "tcp://localhost:5432/x",
    "x://localhost/x",
  ])("solo acepta los esquemas postgres: y postgresql: (%s)", (url) => {
    expect(() => assertLocalTestDatabase(url)).toThrow(/no es válida/);
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

  it.each([
    "pg://u:p@remote.example/db",
    "http://u:p@remote.example/db",
    "tcp://u:p@remote.example/db",
    "x://u:p@remote.example/db",
  ])("valida DATABASE* aunque el valor no mencione postgres (%s)", (value) => {
    // postgres.js ignora el esquema: con pg://u:p@remote.example/db se conectaría a remote.example
    expect(() => assertLocalTestEnv({ DATABASE_URL: value })).toThrow(/DATABASE_URL/);
    expect(() => assertLocalTestEnv({ DATABASE_URL_APP_LOCAL: value })).toThrow(
      /DATABASE_URL_APP_LOCAL/,
    );
  });

  it("falla cerrado con una variable DATABASE* que no es URL", () => {
    expect(() => assertLocalTestEnv({ DATABASE_ALGO: "no-es-url" })).toThrow(/DATABASE_ALGO/);
  });

  it("no valida *_URL sin postgres ni DATABASE* vacías", () => {
    expect(() =>
      assertLocalTestEnv({ AUTH_URL: "https://remoto.example", DATABASE_URL: "  " }),
    ).not.toThrow();
  });

  it("no permite el modo nube", () => {
    expect(() => assertLocalTestEnv({ TEST_DB_TARGET: "cloud" })).toThrow(/nube/);
  });
});
