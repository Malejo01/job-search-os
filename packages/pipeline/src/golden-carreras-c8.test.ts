import { describe, expect, it } from "vitest";
import abogacia from "../test/fixtures/carreras/abogacia.json";
import administracion from "../test/fixtures/carreras/administracion_empresas.json";
import comunicacion from "../test/fixtures/carreras/comunicacion.json";
import contaduria from "../test/fixtures/carreras/finanzas_contabilidad.json";
import marketing from "../test/fixtures/carreras/marketing_digital.json";
import rrpp from "../test/fixtures/carreras/relaciones_publicas.json";
import rrii from "../test/fixtures/carreras/relaciones_internacionales.json";
import { isRoleKey } from "./skills/self-assessment";

/** Golden sintético por carrera (C8-8): forma y reglas del set. El prefiltro lo prueba C8-9. */
const FILES = [abogacia, administracion, comunicacion, contaduria, marketing, rrpp, rrii];
const CATEGORIES = [
  "nueve_mas",
  "remoto_ar",
  "presencial_salta",
  "presencial_caba",
  "remoto_otro_pais",
  "senior_inalcanzable",
  "titulo_enganoso",
  "encaje_parcial",
];

describe("golden sintético por carrera (C8-8)", () => {
  it("54 casos: 8 por cada una de las 6 carreras con golden completo, una por categoría, más los 6 de RR.PP. de C12", () => {
    expect(FILES.flatMap((f) => f.casos)).toHaveLength(54);
    for (const f of FILES) {
      expect(isRoleKey(f.meta.carrera)).toBe(true);
      // Marketing (7) y RR.PP. (1) se reparten los 8 avisos que antes eran de marketing (R6-5)
      if (f !== marketing && f !== rrpp) {
        expect(f.casos.map((c) => c.categoria).sort()).toEqual([...CATEGORIES].sort());
      }
    }
    expect(marketing.casos).toHaveLength(7);
    // RR.PP. junta los 6 avisos de C12 (R5) con el que vino de marketing (R6-5, relaciones_publicas-07)
    expect(rrpp.casos).toHaveLength(7);
    const movido = rrpp.casos.filter((c) => c.id === "relaciones_publicas-07");
    expect(movido).toHaveLength(1);
    expect([...marketing.casos, ...movido].map((c) => c.categoria).sort()).toEqual(
      [...CATEGORIES].sort(),
    );
  });

  it("empresas ficticias, etiquetas válidas y anchor_source assisted", () => {
    for (const c of FILES.flatMap((f) => f.casos)) {
      expect(c.empresa).toMatch(/^Empresa [A-H]$/);
      expect(["must_pass", "must_discard"]).toContain(c.etiquetas.prefiltro);
      expect(["postular", "guardar", "descartar"]).toContain(c.etiquetas.accion_esperada);
      expect(c.anchor_source).toBe("assisted");
      expect(c.jd_text.length).toBeGreaterThan(200);
    }
  });

  it("ids únicos", () => {
    const ids = FILES.flatMap((f) => f.casos.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
