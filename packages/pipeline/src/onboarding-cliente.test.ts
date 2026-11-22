import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `onboarding.ts` (constantes y reglas por defecto) lo importa el código de cliente del formulario. No puede
 * arrastrar el detector de instrucciones ni zod: lo que valida el formulario vive en `onboarding-parse.ts`,
 * solo para el servidor.
 */

const here = dirname(fileURLToPath(import.meta.url));

// Archivos locales alcanzables desde `entry` por imports relativos (incluye `export … from`).
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/(?:import|export)\s[^;]*?from\s+["'](\.[^"']+)["']/g)) {
      const base = resolve(dirname(file), m[1]!);
      const next = [`${base}.ts`, resolve(base, "index.ts")].find((p) => existsSync(p));
      if (next) stack.push(next);
    }
  }
  return seen;
}

describe("onboarding.ts, el módulo que usa el cliente", () => {
  const files = [...reachable(resolve(here, "onboarding.ts"))].map((f) => f.replaceAll("\\", "/"));

  it("no alcanza el detector de instrucciones", () => {
    expect(files.filter((f) => /\/evaluator\/injection\.ts$|\/cv\/injection\.ts$/.test(f))).toEqual(
      [],
    );
  });

  it("no alcanza el módulo de validación del servidor", () => {
    expect(files.filter((f) => f.endsWith("/onboarding-parse.ts"))).toEqual([]);
  });

  it("no importa zod por su cuenta (el schema del formulario vive en el módulo del servidor)", () => {
    expect(readFileSync(resolve(here, "onboarding.ts"), "utf8")).not.toMatch(/from\s+["']zod["']/);
  });

  it("la precarga del cliente no tiene imports", () => {
    expect(readFileSync(resolve(here, "onboarding-prefill.ts"), "utf8")).not.toMatch(
      /^\s*import\s/m,
    );
  });

  it("el módulo del servidor sí usa el detector (el control no se perdió)", () => {
    expect(readFileSync(resolve(here, "onboarding-parse.ts"), "utf8")).toContain(
      "detectEvaluatorInjection(",
    );
  });
});
