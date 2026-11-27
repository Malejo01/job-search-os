import { describe, expect, it } from "vitest";
import routingSeed from "../../../packages/db/seeds/model_routing.json";
import {
  buildAperturaExtras,
  coberturaItem,
  routingEsperadoClaude,
  TERMS_VERSION_ANTES_DEL_552,
  type AperturaExtrasInput,
  type CoberturaCarrera,
} from "../lib/apertura";

const esperado = routingEsperadoClaude(routingSeed);
const base: AperturaExtrasInput = {
  now: new Date("2026-11-26T12:00:00Z"),
  opensAt: new Date("2026-12-01T03:00:00Z"),
  fechaDefinitiva: false,
  termsVersion: TERMS_VERSION_ANTES_DEL_552,
  env: {},
  routingEsperado: esperado,
  routingActual: esperado,
};

const carrera = (over: Partial<CoberturaCarrera> = {}): CoberturaCarrera => ({
  label: "Carrera A",
  tomables: 40,
  paraEmpezar: 12,
  semaforo: "verde",
  ...over,
});

describe("checklist de apertura: cobertura por carrera (R32-02)", () => {
  it("sin lectura del pool queda pendiente y no inventa números", () => {
    for (const cobertura of [null, undefined, []]) {
      const i = coberturaItem(cobertura);
      expect(i.ok).toBe(false);
      expect(i.id).toBe("cobertura");
      expect(i.doc).toBe("/admin/cobertura");
    }
  });

  it("todas en verde: listo", () => {
    const i = coberturaItem([carrera(), carrera({ label: "Carrera B" })]);
    expect(i.ok).toBe(true);
    expect(i.detail).toContain("Las 2 carreras");
    expect(i.todo).toBeNull();
  });

  it("una en rojo: pendiente, y nombra la carrera con sus números", () => {
    const i = coberturaItem([
      carrera(),
      carrera({ label: "Carrera B", tomables: 3, paraEmpezar: 0, semaforo: "rojo" }),
    ]);
    expect(i.ok).toBe(false);
    expect(i.detail).toContain("1 de 2 carreras en verde");
    expect(i.detail).toContain("Carrera B (3 de 30 tomables, 0 de 10 para quien empieza)");
    expect(i.detail).not.toContain("Carrera A");
  });

  it("amarillo tampoco cuenta como listo", () => {
    expect(coberturaItem([carrera({ semaforo: "amarillo" })]).ok).toBe(false);
  });

  it("buildAperturaExtras suma el ítem y sin dato no marca nada como listo", () => {
    const sin = buildAperturaExtras(base).find((i) => i.id === "cobertura");
    expect(sin?.ok).toBe(false);
    const con = buildAperturaExtras({ ...base, cobertura: [carrera()] }).find(
      (i) => i.id === "cobertura",
    );
    expect(con?.ok).toBe(true);
  });
});
