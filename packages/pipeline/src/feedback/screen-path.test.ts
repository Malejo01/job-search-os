import { describe, expect, it } from "vitest";
import { groupFeedbackByScreen, normalizeScreenPath, SCREEN_ROUTE_PATTERNS } from "./screen-path";

const UUID = "3f2b8c1e-9a4d-4e7b-8c21-5d6e7f8a9b0c";

describe("normalizeScreenPath (R26-04)", () => {
  it("pasa los ids de las rutas con segmento dinámico a [id]", () => {
    expect(normalizeScreenPath(`/jobs/${UUID}`)).toBe("/jobs/[id]");
    expect(normalizeScreenPath(`/jobs/${UUID}/postular`)).toBe("/jobs/[id]/postular");
    expect(normalizeScreenPath(`/interview/${UUID}`)).toBe("/interview/[id]");
    expect(normalizeScreenPath(`/inbox/${UUID}`)).toBe("/inbox/[id]");
    expect(normalizeScreenPath(`/admin/personas/${UUID}`)).toBe("/admin/personas/[id]");
    expect(normalizeScreenPath(`/admin/informes/${UUID}`)).toBe("/admin/informes/[id]");
  });

  it("el segmento dinámico no tiene que parecer un id: también los slugs", () => {
    expect(normalizeScreenPath("/academy/como-es-una-entrevista")).toBe("/academy/[slug]");
    expect(normalizeScreenPath("/mercado/abogacia")).toBe("/mercado/[carrera]");
    expect(normalizeScreenPath("/jobs/12345")).toBe("/jobs/[id]");
  });

  it("saca la query y el fragmento", () => {
    expect(normalizeScreenPath(`/jobs/${UUID}?x=1#composicion`)).toBe("/jobs/[id]");
    expect(normalizeScreenPath("/hoy?desde=mail")).toBe("/hoy");
    expect(normalizeScreenPath("/cv#top")).toBe("/cv");
  });

  it("las pantallas fijas hermanas de una ruta dinámica no se confunden con un id", () => {
    expect(normalizeScreenPath("/jobs/new")).toBe("/jobs/new");
    expect(normalizeScreenPath("/jobs/pending-jd")).toBe("/jobs/pending-jd");
    expect(normalizeScreenPath("/demo/contaduria")).toBe("/demo/contaduria");
    expect(normalizeScreenPath("/demo/abogacia")).toBe("/demo/[perfil]");
  });

  it("deja igual lo que no tiene ids y quita la barra final", () => {
    expect(normalizeScreenPath("/")).toBe("/");
    expect(normalizeScreenPath("/hoy/")).toBe("/hoy");
    expect(normalizeScreenPath("/cv/coach/charla")).toBe("/cv/coach/charla");
  });

  it("rutas que no están en la lista: uuid y números pasan a [id], lo demás se conserva", () => {
    expect(normalizeScreenPath(`/otra/${UUID}/editar`)).toBe("/otra/[id]/editar");
    expect(normalizeScreenPath("/otra/777")).toBe("/otra/[id]");
    expect(normalizeScreenPath("/otra/pantalla")).toBe("/otra/pantalla");
  });

  it("es idempotente y reconoce la ruta ya normalizada", () => {
    for (const p of [`/jobs/${UUID}`, "/academy/x", "/hoy", "/jobs/new"]) {
      const once = normalizeScreenPath(p);
      expect(normalizeScreenPath(once)).toBe(once);
    }
    expect(normalizeScreenPath("/jobs/[id]")).toBe("/jobs/[id]");
    expect(normalizeScreenPath("/interview/[id]")).toBe("/interview/[id]");
  });

  it("entradas raras no rompen: vacío, sin barra, no texto", () => {
    expect(normalizeScreenPath("")).toBe("/");
    expect(normalizeScreenPath("hoy")).toBe("/hoy");
    expect(normalizeScreenPath(undefined as unknown as string)).toBe("/");
  });

  it("la lista de rutas conocidas no repite entradas", () => {
    expect(new Set(SCREEN_ROUTE_PATTERNS).size).toBe(SCREEN_ROUTE_PATTERNS.length);
  });
});

describe("groupFeedbackByScreen", () => {
  it("agrupa por pantalla normalizada, con conteo y cuántos siguen nuevos; la más comentada primero", () => {
    const rows = [
      { path: `/jobs/${UUID}`, status: "nuevo" as const },
      { path: "/jobs/999", status: "resuelto" as const },
      { path: "/hoy", status: "nuevo" as const },
      { path: "/jobs/[id]", status: "visto" as const },
    ];
    expect(groupFeedbackByScreen(rows)).toEqual([
      { screen: "/jobs/[id]", count: 3, nuevos: 1 },
      { screen: "/hoy", count: 1, nuevos: 1 },
    ]);
  });

  it("sin filas, sin grupos; empate: orden alfabético", () => {
    expect(groupFeedbackByScreen([])).toEqual([]);
    expect(
      groupFeedbackByScreen([
        { path: "/plan", status: "nuevo" as const },
        { path: "/cv", status: "nuevo" as const },
      ]).map((g) => g.screen),
    ).toEqual(["/cv", "/plan"]);
  });
});
