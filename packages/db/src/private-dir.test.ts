import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { envLocalPath, fixturesPrivateDir, privateBaseDir } from "./private-dir";

/** Carpeta privada fuera del árbol: JSO_PRIVATE_DIR, con la raíz del repo como respaldo. */
const REPO = resolve(tmpdir(), "repo-ficticio");
let externa: string;
let archivo: string;

beforeAll(() => {
  externa = mkdtempSync(join(tmpdir(), "privado-"));
  archivo = join(externa, "no-es-carpeta.txt");
  writeFileSync(archivo, "x");
  mkdirSync(join(externa, "fixtures-private"));
});

afterAll(() => {
  rmSync(externa, { recursive: true, force: true });
});

describe("privateBaseDir", () => {
  it("sin la variable usa la raíz del repo (comportamiento de siempre)", () => {
    expect(privateBaseDir({}, REPO)).toBe(REPO);
  });

  it("con la variable vacía o de solo espacios usa la raíz del repo", () => {
    expect(privateBaseDir({ JSO_PRIVATE_DIR: "" }, REPO)).toBe(REPO);
    expect(privateBaseDir({ JSO_PRIVATE_DIR: "   " }, REPO)).toBe(REPO);
  });

  it("con una carpeta absoluta existente usa esa carpeta", () => {
    expect(privateBaseDir({ JSO_PRIVATE_DIR: externa }, REPO)).toBe(resolve(externa));
  });

  it("recorta espacios alrededor de la ruta", () => {
    expect(privateBaseDir({ JSO_PRIVATE_DIR: `  ${externa}  ` }, REPO)).toBe(resolve(externa));
  });

  it("una ruta relativa falla cerrado: no se resuelve contra el directorio actual", () => {
    expect(() => privateBaseDir({ JSO_PRIVATE_DIR: "../jso-privado" }, REPO)).toThrow(
      /JSO_PRIVATE_DIR.*absoluta/,
    );
    expect(() => privateBaseDir({ JSO_PRIVATE_DIR: "." }, REPO)).toThrow(/absoluta/);
  });

  it("una carpeta que no existe falla cerrado: un error de tipeo no carga otros datos", () => {
    expect(() => privateBaseDir({ JSO_PRIVATE_DIR: join(externa, "no-existe") }, REPO)).toThrow(
      /JSO_PRIVATE_DIR.*no es una carpeta/,
    );
  });

  it("un archivo en lugar de una carpeta falla cerrado", () => {
    expect(() => privateBaseDir({ JSO_PRIVATE_DIR: archivo }, REPO)).toThrow(/no es una carpeta/);
  });

  it("el mensaje de error no repite la ruta configurada", () => {
    try {
      privateBaseDir({ JSO_PRIVATE_DIR: join(externa, "no-existe") }, REPO);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain(externa);
    }
  });
});

describe("envLocalPath y fixturesPrivateDir", () => {
  it("sin la variable apuntan adonde apuntaban antes", () => {
    expect(envLocalPath({}, REPO)).toBe(join(REPO, ".env.local"));
    expect(fixturesPrivateDir({}, REPO)).toBe(join(REPO, "fixtures-private"));
  });

  it("con la variable cuelgan de la carpeta externa", () => {
    const env = { JSO_PRIVATE_DIR: externa };
    expect(envLocalPath(env, REPO)).toBe(join(resolve(externa), ".env.local"));
    expect(fixturesPrivateDir(env, REPO)).toBe(join(resolve(externa), "fixtures-private"));
  });
});
