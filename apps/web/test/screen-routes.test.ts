import { readdirSync } from "node:fs";
import { join } from "node:path";
import { SCREEN_ROUTE_PATTERNS } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";

const APP_DIR = join(__dirname, "..", "app");

/** Rutas de las páginas del árbol de `app/`, sin los grupos `(app)`, `(public)`… */
function appRoutes(): string[] {
  return readdirSync(APP_DIR, { recursive: true, encoding: "utf8" })
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => /(^|\/)page\.tsx$/.test(f))
    .map((f) => {
      const segs = f
        .replace(/(^|\/)page\.tsx$/, "")
        .split("/")
        .filter((s) => s !== "" && !/^\(.+\)$/.test(s));
      return `/${segs.join("/")}`;
    });
}

/**
 * R26-04: `SCREEN_ROUTE_PATTERNS` (packages/pipeline/src/feedback/screen-path.ts) es lo que convierte
 * `/jobs/<id>` en `/jobs/[id]`. Acá se la contrasta con el árbol real de `apps/web/app`: si alguien suma una
 * página con segmento dinámico, este test avisa que hay que sumarla a la lista.
 */
describe("rutas conocidas del feedback (R26-04)", () => {
  const routes = appRoutes();

  it("el recorrido del árbol encuentra las páginas", () => {
    expect(routes.length).toBeGreaterThan(40);
  });

  it("cada ruta de la lista existe en el árbol de app/", () => {
    for (const p of SCREEN_ROUTE_PATTERNS) expect(routes, p).toContain(p);
  });

  it("toda página con segmento dinámico figura en la lista, y también sus hermanas fijas", () => {
    const known = new Set(SCREEN_ROUTE_PATTERNS);
    const dynamic = routes.filter((r) => r.includes("["));
    for (const r of dynamic)
      expect(known.has(r), `falta en SCREEN_ROUTE_PATTERNS: ${r}`).toBe(true);
    // Una pantalla fija que ocuparía el lugar de un segmento dinámico (`/jobs/new` junto a `/jobs/[id]`)
    const sibling = (fixed: string, pattern: string) => {
      const a = fixed.split("/");
      const b = pattern.split("/");
      return a.length === b.length && b.every((seg, i) => seg === a[i] || /^\[.+\]$/.test(seg));
    };
    for (const r of routes.filter((x) => !x.includes("["))) {
      if (dynamic.some((d) => sibling(r, d))) {
        expect(known.has(r), `falta la pantalla fija hermana: ${r}`).toBe(true);
      }
    }
  });
});
