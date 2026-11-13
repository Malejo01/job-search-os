import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRIVATE_PREFIXES,
  isPrivatePath,
  isPublicPath,
  requiresLogin,
} from "../../../apps/web/lib/route-access";

/**
 * R9-4: qué rutas piden sesión. La lista de prefijos privados vive en `apps/web/lib/route-access.ts`
 * (la usa el middleware, en el edge); acá se la contrasta con el árbol real de `apps/web/app`.
 */
const APP_DIR = join(__dirname, "../../../apps/web/app");

type Ruta = { url: string; grupo: string | null; archivo: string };

/** Todas las páginas y rutas de `app/`, con su URL (sin grupos `(x)`, dinámicos como un segmento). */
function rutas(): Ruta[] {
  const out: Ruta[] = [];
  for (const rel of readdirSync(APP_DIR, { recursive: true, encoding: "utf8" })) {
    const partes = rel.split(/[\\/]/);
    const archivo = partes[partes.length - 1] ?? "";
    if (!/^(page|route)\.(ts|tsx)$/.test(archivo)) continue;
    const dirs = partes.slice(0, -1);
    const grupo = dirs.find((d) => /^\(.+\)$/.test(d)) ?? null;
    const segmentos = dirs
      .filter((d) => !/^\(.+\)$/.test(d))
      .map((d) => (/^\[.+\]$/.test(d) ? "x" : d));
    out.push({ url: `/${segmentos.join("/")}`, grupo, archivo: rel });
  }
  return out;
}

describe("acceso a rutas sin sesión (R9-4)", () => {
  const todas = rutas();

  it("el recorrido encuentra el árbol de la app", () => {
    expect(todas.length).toBeGreaterThan(40);
    expect(todas.some((r) => r.grupo === "(app)")).toBe(true);
  });

  it("toda ruta de app/ es pública o está en un prefijo privado (ninguna queda abierta por olvido)", () => {
    for (const r of todas) {
      expect(isPublicPath(r.url) || isPrivatePath(r.url), `${r.archivo} → ${r.url}`).toBe(true);
    }
  });

  it("las rutas de (app), onboarding y terminos-actualizados son privadas y no figuran como públicas", () => {
    const privadas = todas.filter(
      (r) =>
        r.grupo === "(app)" ||
        r.url.startsWith("/onboarding") ||
        r.url.startsWith("/terminos-actualizados"),
    );
    expect(privadas.length).toBeGreaterThan(20);
    for (const r of privadas) {
      expect(isPrivatePath(r.url), `${r.archivo} → ${r.url}`).toBe(true);
      expect(isPublicPath(r.url), `${r.archivo} → ${r.url}`).toBe(false);
      expect(requiresLogin(r.url), r.url).toBe(true);
    }
  });

  it("las rutas de (public), (public-en) y (auth) no piden sesión", () => {
    const publicas = todas.filter(
      (r) => r.grupo === "(public)" || r.grupo === "(public-en)" || r.grupo === "(auth)",
    );
    expect(publicas.length).toBeGreaterThan(15);
    for (const r of publicas) {
      expect(requiresLogin(r.url), `${r.archivo} → ${r.url}`).toBe(false);
    }
  });

  it("toda API privada o pública es una de las conocidas: /api cae en el prefijo privado", () => {
    for (const r of todas.filter((x) => x.url.startsWith("/api"))) {
      expect(isPrivatePath(r.url), r.url).toBe(true);
    }
  });

  it("cada prefijo privado corresponde a una ruta que existe", () => {
    for (const p of PRIVATE_PREFIXES) {
      expect(
        todas.some((r) => r.url === p || r.url.startsWith(`${p}/`)),
        p,
      ).toBe(true);
    }
  });

  it("una ruta inventada no pide login (Next da el 404), también con barras raras", () => {
    for (const p of ["/no-existe", "/foo/bar", "/jobsx", "/hoyy", "/admin", "/en", "/.env"]) {
      expect(requiresLogin(p), p).toBe(false);
    }
  });

  it("los detalles dinámicos de rutas privadas piden login aunque el id sea inventado", () => {
    for (const p of ["/hoy", "/jobs/id-inventado", "/inbox/zzz", "/settings/inventada", "/api/x"]) {
      expect(requiresLogin(p), p).toBe(true);
    }
  });

  it("un request de Server Action (next-action) a una ruta inventada pide sesión", () => {
    for (const p of ["/no-existe", "/foo/bar", "/en", "/%E0%A4%A"]) {
      expect(requiresLogin(p, true), p).toBe(true);
    }
  });

  it("un request de Server Action entra sin sesión solo en las páginas públicas con acciones propias", () => {
    for (const p of [
      "/acceso",
      "/login",
      "/register",
      "/setup",
      "/forgot-password",
      "/reset-password",
    ]) {
      expect(requiresLogin(p, true), p).toBe(false);
    }
    // Públicas sin acciones propias: un POST de acción ahí pide sesión
    for (const p of ["/", "/ayuda", "/mercado/abogacia", "/demo", "/legal/terminos"]) {
      expect(requiresLogin(p, true), p).toBe(true);
    }
  });

  it("las páginas públicas que declaran un Server Action inline son las de la lista de acciones", () => {
    // Si una página nueva de (public)/(auth) suma una acción, hay que sumarla a PUBLIC_ACTION_PREFIXES
    const conAccion = rutas()
      .filter((r) => r.grupo === "(public)" || r.grupo === "(public-en)" || r.grupo === "(auth)")
      .filter((r) => /use server/.test(readFileSync(join(APP_DIR, r.archivo), "utf8")))
      .map((r) => r.url)
      .sort();
    for (const url of conAccion) expect(requiresLogin(url, true), url).toBe(false);
    expect(conAccion).toEqual([
      "/forgot-password",
      "/login",
      "/register",
      "/reset-password",
      "/setup",
    ]);
    // Y los archivos de acciones de las carpetas públicas (acceso/actions.ts)
    const archivos = readdirSync(APP_DIR, { recursive: true, encoding: "utf8" }).filter((f) =>
      /(^|[\\/])\((public|public-en|auth)\)[\\/].*actions\.ts$/.test(f),
    );
    expect(archivos.map((f) => f.replace(/\\/g, "/"))).toEqual(["(public)/acceso/actions.ts"]);
  });

  it("toda Server Action exportada de (app), onboarding y terminos-actualizados exige sesión", () => {
    const GUARD =
      /\b(requireUserId|requireActiveUserId|requireTermsAcceptedUserId|activeSessionUserId|sessionUserId)\(/;
    // `run(...)` (inbox/actions.ts) es un helper local que llama a requireActiveUserId
    const VIA_HELPER = /\brun\(/;
    // `logout` solo cierra la sesión propia (signOut): sin sesión no hace nada, no necesita guarda
    const SIN_GUARDA_A_PROPOSITO = new Set(["(app)/logout-action.ts: logout"]);
    const sinGuarda: string[] = [];
    let acciones = 0;
    const archivos = readdirSync(APP_DIR, { recursive: true, encoding: "utf8" })
      .map((f) => f.replace(/\\/g, "/"))
      .filter(
        (f) =>
          /\.(ts|tsx)$/.test(f) &&
          (f.startsWith("(app)/") ||
            f.startsWith("onboarding/") ||
            f.startsWith("terminos-actualizados/")),
      );
    for (const f of archivos) {
      const src = readFileSync(join(APP_DIR, f), "utf8");
      if (!/^\s*["']use server["']/.test(src)) continue;
      // Cada export va hasta el siguiente `export` (o el fin del archivo)
      const trozos = src
        .split(/\n(?=export )/)
        .filter((t) => /^export (async function|const \w+ = async)/.test(t));
      for (const t of trozos) {
        acciones += 1;
        const nombre = /^export (?:async function|const) (\w+)/.exec(t)?.[1] ?? "?";
        const id = `${f}: ${nombre}`;
        if (!GUARD.test(t) && !VIA_HELPER.test(t) && !SIN_GUARDA_A_PROPOSITO.has(id)) {
          sinGuarda.push(id);
        }
      }
    }
    expect(acciones, "el recorrido no encontró acciones").toBeGreaterThan(40);
    expect(sinGuarda).toEqual([]);
  });

  it("no se salta con mayúsculas, porcentajes, barras repetidas o barra final", () => {
    for (const p of ["/Jobs", "/%6Aobs", "/%6aobs/1", "//jobs", "/jobs/", "/hoy/", "/%E0%A4%A"]) {
      expect(requiresLogin(p), p).toBe(true);
    }
  });

  it("lo público sigue siendo público", () => {
    for (const p of [
      "/",
      "/acceso",
      "/login",
      "/ayuda",
      "/mercado/abogacia",
      "/demo/contaduria",
      "/legal/privacidad",
      "/opengraph-image-es",
      "/icons/icon-192.png",
      "/manifest.webmanifest",
    ]) {
      expect(requiresLogin(p), p).toBe(false);
    }
  });
});
