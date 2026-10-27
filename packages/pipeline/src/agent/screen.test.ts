import { describe, expect, it } from "vitest";
import {
  AGENT_SCREENS,
  destinationForScreen,
  parseScreenContext,
  screenFromPath,
  screenLabel,
} from "./screen";

const JOB = "0b9c6a1e-3f2d-4c5b-8a7e-1d2c3b4a5f60";

describe("screenFromPath", () => {
  it("reconoce las pantallas conocidas e ignora query, hash y barra final", () => {
    expect(screenFromPath("/hoy")).toEqual({ screen: "/hoy" });
    expect(screenFromPath("/settings/perfil?x=1#y")).toEqual({ screen: "/settings/perfil" });
    expect(screenFromPath("/jobs/")).toEqual({ screen: "/jobs" });
  });

  it("el detalle de una oferta lleva el id solo si es un uuid", () => {
    expect(screenFromPath(`/jobs/${JOB.toUpperCase()}`)).toEqual({
      screen: "/jobs/[id]",
      jobId: JOB,
    });
    expect(screenFromPath("/jobs/new")).toBeNull();
    expect(screenFromPath("/jobs/[id]")).toBeNull();
  });

  it("lo que sale de screenFromPath siempre pasa parseScreenContext", () => {
    for (const id of [
      JOB,
      "00000000-0000-0000-0000-000000000000",
      "123e4567-e89b-12d3-a456-426614174000",
    ]) {
      const ctx = screenFromPath(`/jobs/${id}`);
      if (ctx) expect(parseScreenContext(ctx).ok).toBe(true);
    }
  });

  it("una ruta enorme devuelve null sin colgarse", () => {
    const t0 = performance.now();
    expect(screenFromPath("/".repeat(100_000) + "a")).toBeNull();
    expect(screenFromPath("/jobs/" + "a".repeat(300))).toBeNull();
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it("lo desconocido devuelve null", () => {
    expect(screenFromPath("/")).toBeNull();
    expect(screenFromPath("/admin")).toBeNull();
    expect(screenFromPath("/jobs/x/y")).toBeNull();
  });
});

describe("parseScreenContext", () => {
  it("acepta una pantalla de la lista y el id solo en el detalle", () => {
    expect(parseScreenContext({ screen: "/market" }).ok).toBe(true);
    expect(parseScreenContext({ screen: "/jobs/[id]", jobId: JOB }).ok).toBe(true);
  });

  it("rechaza jobId fuera del detalle, pantallas inventadas y campos de más", () => {
    expect(parseScreenContext({ screen: "/market", jobId: JOB })).toEqual({
      ok: false,
      error: "screen_invalida",
    });
    expect(parseScreenContext({ screen: "/admin" }).ok).toBe(false);
    expect(parseScreenContext({ screen: "/hoy", note: "x" }).ok).toBe(false);
    expect(parseScreenContext({ screen: "/jobs/[id]", jobId: "no-uuid" }).ok).toBe(false);
    expect(parseScreenContext(null).ok).toBe(false);
  });
});

describe("destinationForScreen y screenLabel", () => {
  it("las pantallas con formulario tienen destino; el resto no", () => {
    expect(destinationForScreen("/settings/perfil")).toBe("profile");
    expect(destinationForScreen("/settings/skills")).toBe("skill_levels");
    expect(destinationForScreen("/settings/criteria")).toBe("criteria");
    expect(destinationForScreen("/settings")).toBe("target_roles");
    expect(destinationForScreen("/jobs")).toBeNull();
  });

  it("todas las pantallas tienen etiqueta en español", () => {
    for (const s of AGENT_SCREENS) expect(screenLabel(s).length).toBeGreaterThan(2);
  });
});
