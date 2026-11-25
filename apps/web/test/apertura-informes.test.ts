import { describe, expect, it } from "vitest";
import routingSeed from "../../../packages/db/seeds/model_routing.json";
import {
  buildAperturaExtras,
  routingEsperadoClaude,
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
const informes = (input: AperturaExtrasInput) =>
  buildAperturaExtras(input).find((i) => i.id === "informes_revision")!;

describe("checklist de apertura: informes de revisión (R29-05)", () => {
  it("con las tablas en la base queda listo", () => {
    expect(informes({ ...base, informesTabla: true }).ok).toBe(true);
  });
  it("sin las tablas o sin poder leerlas queda pendiente, con el paso manual", () => {
    for (const v of [false, null, undefined]) {
      const i = informes({ ...base, informesTabla: v });
      expect(i.ok).toBe(false);
      expect(i.todo).toContain("0084");
      expect(i.doc).toContain("pasos-manuales-r29");
    }
    expect(informes({ ...base, informesTabla: false }).detail).toContain("todavía no están");
    expect(informes({ ...base, informesTabla: null }).detail).toContain("No se pudo leer");
  });
});
