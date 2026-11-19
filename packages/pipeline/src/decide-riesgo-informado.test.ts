import { describe, expect, it } from "vitest";
import criteria from "../../db/seeds/criteria.example.json";
import type { CriteriaRules } from "./criteria";
import { decide } from "./decide";
import type { Evaluation } from "./evaluation";
import { INJECTION_RISK } from "./evaluator/injection";

const rules = criteria as CriteriaRules;

const limpio: Evaluation = {
  score: 9,
  confianza: "alta",
  years_required: null,
  location_ok: "ok",
  modalidad: "remoto",
  disciplina: "ai_engineer",
  ingles_requerido: "intermedio",
  tipo_empresa: "producto",
  paises_permitidos: ["AR"],
  match_fuerte: ["RAG"],
  gaps: [],
  bloqueadores_duros: [],
  senales_positivas: [],
  veredicto: "ok",
  accion_sugerida: "aplicar_personalizado",
  riesgos: [],
  years_domain: null,
  years_discipline: null,
};

describe("decide(): el riesgo de instrucciones informado por el modelo también topa", () => {
  it("score alto, sin la flag del detector y con el riesgo informado: queda en guardar", () => {
    const d = decide({ ...limpio, riesgos: [INJECTION_RISK] }, rules);
    expect(d.scoreFinal).toBe(rules.thresholds.guardar);
    expect(d.accion).toBe("guardar");
    expect(d.riesgos).toContain(INJECTION_RISK);
    expect(d.adjustments.some((a) => a.rule === "injection_cap")).toBe(true);
  });

  it.each([
    ["mayúsculas", "AVISO CON INSTRUCCIONES AL EVALUADOR"],
    ["espacios de más", "  aviso   con instrucciones\tal  evaluador "],
    ["punto final", "Aviso con instrucciones al evaluador."],
    ["con tilde de más", "Aviso con instrucciónes al evaluador"],
  ])("lo reconoce con %s", (_name, risk) => {
    const d = decide({ ...limpio, riesgos: [risk] }, rules);
    expect(d.scoreFinal).toBe(rules.thresholds.guardar);
    expect(d.accion).toBe("guardar");
  });

  it.each([
    ["recortado", "aviso con instrucciones"],
    ["con más texto", "aviso con instrucciones al evaluador y otras cosas"],
    ["otra frase parecida", "aviso con instrucciones para el candidato"],
    ["mezclado con otro riesgo", "salario no publicado; aviso con instrucciones al evaluador"],
  ])("no confunde una frase parecida: %s", (_name, risk) => {
    const d = decide({ ...limpio, riesgos: [risk] }, rules);
    expect(d.adjustments.some((a) => a.rule === "injection_cap")).toBe(false);
    expect(d.scoreFinal).toBe(9);
  });

  it("score bajo: el score no cambia y sigue descartando, nunca descarta de más", () => {
    const d = decide({ ...limpio, score: 4, riesgos: [INJECTION_RISK] }, rules);
    expect(d.scoreFinal).toBe(4);
    expect(d.accion).toBe("descartar");
    expect(d.adjustments.some((a) => a.rule === "injection_cap")).toBe(false);
  });

  it("no duplica el riesgo en la lista", () => {
    const d = decide({ ...limpio, riesgos: ["AVISO CON INSTRUCCIONES AL EVALUADOR"] }, rules);
    expect(
      d.riesgos.filter((r) => r.toLowerCase().includes("instrucciones al evaluador")),
    ).toHaveLength(1);
  });
});
