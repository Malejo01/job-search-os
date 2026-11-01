import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BRAND } from "./brand";
import { PRODUCT_NAME } from "./product";

/**
 * C6-2: el nombre del producto vive en `brand.ts`. Ningún otro archivo de código lo escribe a mano
 * (UI, emails, metadata, User-Agent): cambiar de nombre es editar `BRAND.name`. Quedan afuera los
 * textos legales (carril rojo, los revisa Mauro), los tests, los e2e y las fixtures.
 */
const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const SCAN_DIRS = ["apps/web/app", "apps/web/components", "apps/web/lib", "packages"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "e2e",
  "__fixtures__",
  "fixtures",
  "legal",
]);
const EXT = /\.(ts|tsx|mjs|json)$/;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (EXT.test(name) && !/\.test\.tsx?$/.test(name)) yield full;
  }
}

describe("marca en un solo lugar", () => {
  it("PRODUCT_NAME sale de BRAND.name", () => {
    expect(PRODUCT_NAME).toBe(BRAND.name);
  });

  it("ningún archivo de código, salvo brand.ts, escribe el nombre a mano", () => {
    const names = [BRAND.name, BRAND.name.replace(/\s+/g, "")];
    const offenders: string[] = [];
    for (const d of SCAN_DIRS) {
      for (const file of walk(join(ROOT, d))) {
        const rel = relative(ROOT, file).split(sep).join("/");
        if (rel === "packages/pipeline/src/brand.ts") continue;
        // Las seeds de ejemplo son datos de muestra, no UI
        if (rel.startsWith("packages/db/seeds/")) continue;
        const text = readFileSync(file, "utf8");
        for (const n of names) if (text.includes(n)) offenders.push(`${rel}: «${n}»`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
