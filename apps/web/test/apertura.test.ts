import { describe, expect, it } from "vitest";
import routingSeed from "../../../packages/db/seeds/model_routing.json";
import {
  buildAperturaExtras,
  routingEsperadoClaude,
  TAREAS_RUTEO_S4,
  TERMS_VERSION_ANTES_DEL_552,
  type AperturaExtrasInput,
} from "../lib/apertura";

const esperado = routingEsperadoClaude(routingSeed);

const base: AperturaExtrasInput = {
  now: new Date("2026-11-25T12:00:00Z"),
  opensAt: new Date("2026-12-01T03:00:00Z"),
  fechaDefinitiva: false,
  termsVersion: TERMS_VERSION_ANTES_DEL_552,
  env: {},
  routingEsperado: esperado,
  routingActual: esperado,
};

const item = (input: AperturaExtrasInput, id: string) =>
  buildAperturaExtras(input).find((i) => i.id === id)!;

describe("checklist de apertura: ítems nuevos (R28-03)", () => {
  it("el ruteo esperado cubre las 9 tareas de ruteo-s4 con lo que dice el seed", () => {
    expect(esperado.map((r) => r.task).sort()).toEqual([...TAREAS_RUTEO_S4].sort());
  });

  it("términos: con la versión de antes del #552 queda pendiente y nunca ✓ por defecto", () => {
    const t = item(base, "terminos");
    expect(t.ok).toBe(false);
    expect(t.detail).toContain("#552");
    expect(t.doc).toContain("docs/beta/");
  });

  it("términos: con una versión posterior se da por traído", () => {
    expect(item({ ...base, termsVersion: "2026-12-01" }, "terminos").ok).toBe(true);
  });

  it("voz: solo «all» es listo; testers, off y valores raros quedan pendientes", () => {
    const voz = (v?: string) => item({ ...base, env: { VOICE_SERVER_TRANSCRIBE: v } }, "voz");
    expect(voz("all").ok).toBe(true);
    expect(voz(" ALL ").ok).toBe(true);
    expect(voz("testers").ok).toBe(false);
    expect(voz("testers").detail).toContain("testers");
    expect(voz("off").ok).toBe(false);
    expect(voz(undefined).ok).toBe(false);
    expect(voz("si").ok).toBe(false);
  });

  it("ruteo a Claude: listo cuando la base coincide con el seed", () => {
    expect(item(base, "ruteo_claude").ok).toBe(true);
  });

  it("ruteo a Claude: pendiente si una tarea tiene otro modelo o falta, y dice cuáles", () => {
    const actual = esperado
      .filter((r) => r.task !== "cv_write")
      .map((r) => (r.task === "evaluate_job" ? { ...r, provider: "google", model: "otro" } : r));
    const r = item({ ...base, routingActual: actual }, "ruteo_claude");
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("evaluate_job");
    expect(r.detail).toContain("cv_write");
    expect(r.todo).toContain("ruteo-s4.sql");
  });

  it("ruteo a Claude: sin lectura de la base queda pendiente", () => {
    const r = item({ ...base, routingActual: null }, "ruteo_claude");
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("No se pudo leer");
  });

  it("fecha definitiva: provisoria es pendiente y muestra la fecha; confirmada es listo", () => {
    const p = item(base, "fecha_definitiva");
    expect(p.ok).toBe(false);
    expect(p.detail).toContain("1 de diciembre");
    expect(item({ ...base, fechaDefinitiva: true }, "fecha_definitiva").ok).toBe(true);
  });

  it("fecha definitiva: una fecha inválida es pendiente", () => {
    const r = item(
      { ...base, opensAt: new Date("nada"), fechaDefinitiva: true },
      "fecha_definitiva",
    );
    expect(r.ok).toBe(false);
  });

  it("el texto de ningún ítem incluye el valor de una variable", () => {
    const SECRETO = "valor-secreto-inventado-123";
    const items = buildAperturaExtras({
      ...base,
      env: {
        VOICE_SERVER_TRANSCRIBE: "all",
        RESEND_API_KEY: SECRETO,
        MP_LINK_LISTA: SECRETO,
        DATABASE_URL: SECRETO,
      },
    });
    expect(JSON.stringify(items)).not.toContain(SECRETO);
  });
});
