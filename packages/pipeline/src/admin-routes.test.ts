import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_ONLY_FILES, MEMBER_FILES } from "../../../apps/web/lib/admin-routes";

/**
 * R11-6: toda pantalla, ruta y Server Action de administración comprueba el rol en el servidor.
 * La lista vive en `apps/web/lib/admin-routes.ts` y el helper en `apps/web/lib/admin-guard.ts`; acá se
 * la contrasta con el árbol real de `apps/web/app`.
 */
const APP_DIR = join(__dirname, "../../../apps/web/app");

const GUARDS = {
  page: /\b(requireAdminOr404)\(/,
  route: /\b(adminRouteDenied)\(/,
  action: /\b(requireAdminOr404|requireAdminOrThrow)\(/,
} as const;

/** Archivos del árbol bajo `settings/` o `admin/` (en cualquier grupo) o de la lista de admin. */
function relevantes(): string[] {
  return readdirSync(APP_DIR, { recursive: true, encoding: "utf8" })
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => /(^|\/)(settings|admin)\//.test(f))
    .filter((f) => {
      if (/(^|\/)(page|route)\.(ts|tsx)$/.test(f)) return true;
      return /^\s*["']use server["']/.test(readFileSync(join(APP_DIR, f), "utf8"));
    })
    .sort();
}

function tipo(f: string): keyof typeof GUARDS {
  if (/(^|\/)page\.tsx?$/.test(f)) return "page";
  if (/(^|\/)route\.ts$/.test(f)) return "route";
  return "action";
}

describe("rol de admin en settings y admin (R11-6)", () => {
  const todos = relevantes();

  it("el recorrido encuentra el árbol de settings", () => {
    expect(todos.length).toBeGreaterThan(25);
    expect(todos.some((f) => f.includes("settings/invitations/"))).toBe(true);
  });

  it("las dos listas no se pisan y apuntan a archivos que existen", () => {
    for (const f of ADMIN_ONLY_FILES) expect(MEMBER_FILES.includes(f), f).toBe(false);
    for (const f of [...ADMIN_ONLY_FILES, ...MEMBER_FILES]) {
      expect(existsSync(join(APP_DIR, f)), `no existe: ${f}`).toBe(true);
    }
  });

  it("todo archivo de settings/admin figura en la lista de admin o en la de cuentas comunes", () => {
    const conocidos = new Set([...ADMIN_ONLY_FILES, ...MEMBER_FILES]);
    const sinLista = todos.filter((f) => !conocidos.has(f));
    expect(sinLista, "sumalos a ADMIN_ONLY_FILES o a MEMBER_FILES en lib/admin-routes.ts").toEqual(
      [],
    );
  });

  it("cada archivo de admin llama al helper de lib/admin-guard", () => {
    const sinGuarda: string[] = [];
    for (const f of ADMIN_ONLY_FILES) {
      const src = readFileSync(join(APP_DIR, f), "utf8");
      if (!/from "@\/lib\/admin-guard"/.test(src)) {
        sinGuarda.push(`${f}: no importa admin-guard`);
        continue;
      }
      if (tipo(f) !== "action") {
        if (!GUARDS[tipo(f)].test(src)) sinGuarda.push(`${f}: no llama a la guarda`);
        continue;
      }
      // Server Actions: cada export hasta el siguiente `export` tiene que llamar a la guarda
      const trozos = src
        .split(/\n(?=export )/)
        .filter((t) => /^export (async function|const \w+ = async)/.test(t));
      expect(trozos.length, f).toBeGreaterThan(0);
      for (const t of trozos) {
        const nombre = /^export (?:async function|const) (\w+)/.exec(t)?.[1] ?? "?";
        if (!GUARDS.action.test(t)) sinGuarda.push(`${f}: ${nombre}`);
      }
    }
    expect(sinGuarda).toEqual([]);
  });

  it("la guarda va antes de leer datos: en una página, antes de cualquier otra consulta", () => {
    // La primera llamada a la guarda tiene que aparecer antes que `await` de otra función de datos
    for (const f of ADMIN_ONLY_FILES.filter((x) => tipo(x) === "page")) {
      const src = readFileSync(join(APP_DIR, f), "utf8");
      const idx = src.search(/\brequireAdminOr404\(/);
      const cuerpo = src.slice(src.search(/export default async function/));
      const dentro = cuerpo.search(/\brequireAdminOr404\(/);
      expect(idx, f).toBeGreaterThan(-1);
      const antes = cuerpo.slice(0, dentro);
      // Nada de acceso a datos del usuario antes de la guarda (requireUserId y searchParams son sesión/URL)
      const accesos = [...antes.matchAll(/await\s+(\w+)\(/g)]
        .map((m) => m[1])
        .filter((n) => n !== "requireUserId");
      expect(accesos, f).toEqual([]);
    }
  });
});
