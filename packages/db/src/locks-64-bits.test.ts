import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Los locks consultivos usan claves de 64 bits con namespace: dos operaciones ajenas no comparten clave. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SOURCES = ["apps/web/app", "apps/web/lib", "packages/adapters/src", "packages/db/src"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === ".next") return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("locks consultivos", () => {
  it("ningún lock usa la clave de 32 bits", () => {
    const offenders = SOURCES.flatMap((dir) => sourceFiles(join(ROOT, dir)))
      .filter((file) => /advisory_(xact_)?lock\(hashtext\(/.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file).replaceAll("\\", "/"));
    expect(offenders).toEqual([]);
  });
});
