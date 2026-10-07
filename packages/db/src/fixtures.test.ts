import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadFixture } from "./fixtures";

/** JS-065 · SEED_FIXTURES=example ignora fixtures-private/. Se simula con un directorio temporal. */
let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "fixtures-"));
  mkdirSync(join(root, "fixtures-private"));
  mkdirSync(join(root, "packages/db/seeds"), { recursive: true });
  writeFileSync(join(root, "fixtures-private/profile.json"), JSON.stringify({ from: "privado" }));
  writeFileSync(
    join(root, "packages/db/seeds/profile.example.json"),
    JSON.stringify({ from: "ejemplo" }),
  );
  writeFileSync(
    join(root, "packages/db/seeds/criteria.example.json"),
    JSON.stringify({ from: "ejemplo" }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("loadFixture", () => {
  it("sin la variable usa el archivo privado si existe", () => {
    vi.stubEnv("SEED_FIXTURES", "");
    const fx = loadFixture<{ from: string }>("profile", root);
    expect(fx.source).toBe("private");
    expect(fx.data.from).toBe("privado");
  });

  it("sin el archivo privado usa el de ejemplo", () => {
    vi.stubEnv("SEED_FIXTURES", "");
    const fx = loadFixture<{ from: string }>("criteria", root);
    expect(fx.source).toBe("example");
  });

  it('con SEED_FIXTURES="example" usa el de ejemplo aunque exista el privado', () => {
    vi.stubEnv("SEED_FIXTURES", "example");
    const fx = loadFixture<{ from: string }>("profile", root);
    expect(fx.source).toBe("example");
    expect(fx.data.from).toBe("ejemplo");
  });

  it("con un valor inválido tira un error claro", () => {
    vi.stubEnv("SEED_FIXTURES", "exmaple");
    expect(() => loadFixture("profile", root)).toThrow(/SEED_FIXTURES inválido/);
  });
});
