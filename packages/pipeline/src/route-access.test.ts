import { readdirSync } from "node:fs";
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
