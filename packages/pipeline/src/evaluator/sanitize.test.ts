import { describe, expect, it } from "vitest";
import type { Evaluation } from "../evaluation";
import { sanitizeEvaluation } from "./sanitize";

const clean: Evaluation = {
  score: 7,
  confianza: "alta",
  years_required: 2,
  location_ok: "ok",
  modalidad: "remoto",
  disciplina: "marketing_digital",
  ingles_requerido: "intermedio",
  tipo_empresa: "producto",
  paises_permitidos: ["AR", "CL"],
  match_fuerte: ["SEO", "Email marketing"],
  gaps: [{ skill: "Google Ads", nivel: "deseable" }],
  bloqueadores_duros: [],
  senales_positivas: ["equipo chico"],
  veredicto: "Buen encaje con el puesto.",
  accion_sugerida: "aplicar",
  riesgos: ["salario no publicado"],
  years_domain: "marketing de contenidos",
  years_discipline: "marketing_digital",
};

describe("sanitizeEvaluation", () => {
  it("salida limpia = idéntica y sin campos tocados", () => {
    const r = sanitizeEvaluation(clean);
    expect(r.evaluation).toEqual(clean);
    expect(r.sanitized).toEqual([]);
  });

  it("recorta textos libres a 160 y el veredicto a 200", () => {
    const r = sanitizeEvaluation({
      ...clean,
      riesgos: ["r".repeat(300)],
      match_fuerte: ["m".repeat(161)],
      gaps: [{ skill: "g".repeat(500), nivel: "must" }],
      bloqueadores_duros: ["b".repeat(200)],
      senales_positivas: ["s".repeat(200)],
      paises_permitidos: ["p".repeat(200)],
      years_domain: "d".repeat(200),
      veredicto: "v".repeat(250),
    });
    expect(r.evaluation.riesgos[0]).toHaveLength(160);
    expect(r.evaluation.match_fuerte[0]).toHaveLength(160);
    expect(r.evaluation.gaps[0]!.skill).toHaveLength(160);
    expect(r.evaluation.gaps[0]!.nivel).toBe("must");
    expect(r.evaluation.bloqueadores_duros[0]).toHaveLength(160);
    expect(r.evaluation.senales_positivas[0]).toHaveLength(160);
    expect(r.evaluation.paises_permitidos![0]).toHaveLength(160);
    expect(r.evaluation.years_domain).toHaveLength(160);
    expect(r.evaluation.veredicto).toHaveLength(200);
    expect(r.sanitized.sort()).toEqual(
      [
        "bloqueadores_duros",
        "gaps",
        "match_fuerte",
        "paises_permitidos",
        "riesgos",
        "senales_positivas",
        "veredicto",
        "years_domain",
      ].sort(),
    );
  });

  it("reemplaza URLs y emails por [enlace quitado]", () => {
    const r = sanitizeEvaluation({
      ...clean,
      veredicto: "Mirá https://ejemplo.invalid/x?a=1 ahora",
      riesgos: ["mail x@ejemplo.test", "visitar www.sitio.invalid/x"],
    });
    expect(r.evaluation.veredicto).toBe("Mirá [enlace quitado] ahora");
    expect(r.evaluation.riesgos).toEqual(["mail [enlace quitado]", "visitar [enlace quitado]"]);
    expect(r.sanitized).toEqual(expect.arrayContaining(["veredicto", "riesgos"]));
  });

  it("quita otros esquemas, defanged y dominios con TLD común", () => {
    const r = sanitizeEvaluation({
      ...clean,
      riesgos: [
        "abrir ftp://host.invalid/x",
        "abrir javascript:alert(1)",
        "abrir data:text/html;base64,AAAA",
        "abrir hxxps://sitio.invalid/a",
        "abrir sitio[.]invalid/a",
        "abrir sitio.ejemplo.com/ruta",
        "ver mundial2026.co/promo",
      ],
    });
    expect(r.evaluation.riesgos[6]).toBe("ver [enlace quitado]");
    expect(r.evaluation.riesgos.slice(0, 6)).toEqual(Array(6).fill("abrir [enlace quitado]"));
  });

  it("no toca nombres de tecnologías ni texto normal", () => {
    const r = sanitizeEvaluation({
      ...clean,
      senales_positivas: ["Node.js y Vue.js", "equipo de 5.5 personas"],
    });
    expect(r.evaluation.senales_positivas).toEqual(["Node.js y Vue.js", "equipo de 5.5 personas"]);
    expect(r.sanitized).toEqual([]);
  });

  it("quita invisibles nuevos (guion blando, BOM, etiquetas Unicode)", () => {
    const r = sanitizeEvaluation({ ...clean, veredicto: "a­b﻿c\u{E0041}d⁠e" });
    expect(r.evaluation.veredicto).toBe("abcde");
  });

  it("quita caracteres de control y de ancho cero, conserva acentos", () => {
    const r = sanitizeEvaluation({
      ...clean,
      veredicto: "ok\u0000\u0007 co​n acción‮",
    });
    expect(r.evaluation.veredicto).toBe("ok con acción");
    expect(r.sanitized).toEqual(["veredicto"]);
  });

  it("acota las listas", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `x${i}`);
    const r = sanitizeEvaluation({
      ...clean,
      bloqueadores_duros: many(15),
      riesgos: many(15),
      senales_positivas: many(15),
      paises_permitidos: many(60),
      match_fuerte: many(12),
      gaps: many(12).map((skill) => ({ skill, nivel: "deseable" as const })),
    });
    expect(r.evaluation.bloqueadores_duros).toHaveLength(10);
    expect(r.evaluation.riesgos).toHaveLength(10);
    expect(r.evaluation.senales_positivas).toHaveLength(10);
    expect(r.evaluation.paises_permitidos).toHaveLength(40);
    expect(r.evaluation.match_fuerte).toHaveLength(8);
    expect(r.evaluation.gaps).toHaveLength(8);
    expect(r.sanitized).toHaveLength(6);
  });

  it("paises_permitidos y years_domain null quedan null", () => {
    const r = sanitizeEvaluation({ ...clean, paises_permitidos: null, years_domain: null });
    expect(r.evaluation.paises_permitidos).toBeNull();
    expect(r.evaluation.years_domain).toBeNull();
  });

  it("no muta la entrada", () => {
    const input = { ...clean, riesgos: ["https://ejemplo.invalid"] };
    sanitizeEvaluation(input);
    expect(input.riesgos).toEqual(["https://ejemplo.invalid"]);
  });
});
