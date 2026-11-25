import { readdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeScreenPath } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import {
  NO_TARGETS,
  RECORRIDO_GROUPS,
  RECORRIDO_SCREENS,
  parseReviewed,
  recorridoKey,
  resolveOpen,
} from "../lib/recorrido";

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

describe("recorrido para revisar (R26-03)", () => {
  const routes = new Set(appRoutes());

  it("el recorrido del árbol encuentra las páginas", () => {
    expect(routes.size).toBeGreaterThan(40);
    expect(routes.has("/hoy")).toBe(true);
    expect(routes.has("/jobs/[id]")).toBe(true);
  });

  it("cada pantalla apunta a una ruta que existe en el árbol de app/", () => {
    for (const s of RECORRIDO_SCREENS) {
      expect(routes.has(s.route), `${s.id}: ${s.route}`).toBe(true);
      expect(routes.has(s.listRoute), `${s.id} (lista): ${s.listRoute}`).toBe(true);
    }
  });

  it("los grupos son los del pedido y cada pantalla pertenece a uno", () => {
    expect(RECORRIDO_GROUPS.map((g) => g.id)).toEqual([
      "hoy",
      "match",
      "cv",
      "tracker",
      "interview",
      "academy",
      "plan",
      "primer-uso",
      "vacios",
      "pruebas",
    ]);
    const ids = new Set<string>(RECORRIDO_GROUPS.map((g) => g.id));
    for (const s of RECORRIDO_SCREENS) expect(ids.has(s.group), s.id).toBe(true);
    for (const g of RECORRIDO_GROUPS) {
      expect(
        RECORRIDO_SCREENS.some((s) => s.group === g.id),
        g.id,
      ).toBe(true);
    }
  });

  it("ids únicos, una línea de qué es y exactamente tres cosas para mirar", () => {
    expect(new Set(RECORRIDO_SCREENS.map((s) => s.id)).size).toBe(RECORRIDO_SCREENS.length);
    for (const s of RECORRIDO_SCREENS) {
      expect(s.what.trim().length, s.id).toBeGreaterThan(10);
      expect(s.what.includes("\n"), s.id).toBe(false);
      expect(s.look, s.id).toHaveLength(3);
      for (const l of s.look) expect(l.trim().length, `${s.id}: ${l}`).toBeGreaterThan(10);
    }
  });

  it("incluye las pantallas pedidas, con su ruta real", () => {
    const route = (id: string) => RECORRIDO_SCREENS.find((s) => s.id === id)?.route;
    expect(route("hoy")).toBe("/hoy");
    expect(route("match-lista")).toBe("/jobs");
    expect(route("match-oferta")).toBe("/jobs/[id]");
    expect(route("match-preparar")).toBe("/jobs/[id]/postular");
    expect(route("cv-diagnostico")).toBe("/cv");
    expect(route("cv-coach")).toBe("/cv/coach");
    expect(route("cv-armar")).toBe("/cv/armar");
    expect(route("tracker")).toBe("/applications");
    expect(route("interview-inicio")).toBe("/interview");
    expect(route("academy")).toBe("/academy");
    expect(route("plan")).toBe("/plan");
  });

  it("sin datos propios, «Abrir» cae en la lista; con datos, resuelve el id", () => {
    const oferta = RECORRIDO_SCREENS.find((s) => s.id === "match-oferta")!;
    expect(resolveOpen(oferta, NO_TARGETS)).toEqual({ href: "/jobs", resolved: false });
    expect(resolveOpen(oferta, { ...NO_TARGETS, jobId: "abc" })).toEqual({
      href: "/jobs/abc",
      resolved: true,
    });
    const preparar = RECORRIDO_SCREENS.find((s) => s.id === "match-preparar")!;
    expect(resolveOpen(preparar, { ...NO_TARGETS, jobId: "abc" }).href).toBe("/jobs/abc/postular");

    const pregunta = RECORRIDO_SCREENS.find((s) => s.id === "interview-pregunta")!;
    const informe = RECORRIDO_SCREENS.find((s) => s.id === "interview-informe")!;
    const targets = { jobId: null, interviewActiveId: "en-curso", interviewDoneId: "lista" };
    expect(resolveOpen(pregunta, targets).href).toBe("/interview/en-curso");
    expect(resolveOpen(informe, targets).href).toBe("/interview/lista");
    // Si solo hay de un tipo, se usa esa
    expect(resolveOpen(informe, { ...targets, interviewDoneId: null }).href).toBe(
      "/interview/en-curso",
    );
    expect(resolveOpen(pregunta, NO_TARGETS)).toEqual({ href: "/interview", resolved: false });

    const hoy = RECORRIDO_SCREENS.find((s) => s.id === "hoy")!;
    expect(resolveOpen(hoy, NO_TARGETS)).toEqual({ href: "/hoy", resolved: true });
  });

  it("el progreso guardado ignora lo que no es una pantalla conocida y no rompe con basura", () => {
    expect(parseReviewed(null)).toEqual([]);
    expect(parseReviewed("no es json")).toEqual([]);
    expect(parseReviewed('{"a":1}')).toEqual([]);
    expect(parseReviewed('["hoy","hoy","inventada",5,"plan"]')).toEqual(["hoy", "plan"]);
    expect(recorridoKey("u1")).toContain("u1");
  });

  it("los destinos dinámicos sin datos explican cómo llegar", () => {
    for (const s of RECORRIDO_SCREENS) {
      if (s.open.kind === "job" || s.open.kind === "interview") {
        expect(s.howTo, s.id).toBeTruthy();
      }
    }
  });

  it("la pantalla del feedback de cada una queda como su ruta del árbol, sin ids", () => {
    for (const s of RECORRIDO_SCREENS) expect(normalizeScreenPath(s.route), s.id).toBe(s.route);
  });
});
