import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EVALUATE_JOB_SCHEMA_VERSIONS, outputSchemaFor } from "../evaluation";
import { evaluationWireFor, normalizeEvaluationOutput } from "./wire";

const base = {
  score: 7.5,
  confianza: "alta",
  years_required: 2,
  location_ok: "ok",
  modalidad: "remoto",
  disciplina: "fullstack",
  ingles_requerido: "no_menciona",
  tipo_empresa: "producto",
  paises_permitidos: null,
  match_fuerte: ["TypeScript"],
  gaps: [{ skill: "Rust", nivel: "must" }],
  bloqueadores_duros: [],
  senales_positivas: [],
  veredicto: "Encaja bien con el perfil.",
  accion_sugerida: "aplicar",
  riesgos: [],
  years_domain: null,
  years_discipline: null,
};

const REF = "evaluate_job@v1.3.4";
const parse = (raw: unknown) => outputSchemaFor(REF).safeParse(normalizeEvaluationOutput(raw));

describe("normalizeEvaluationOutput", () => {
  it("veredicto de 230 caracteres y 10 gaps: queda en 200 y 8", () => {
    const veredicto = Array.from({ length: 46 }, () => "abcd").join(" "); // 229 caracteres
    const gaps = Array.from({ length: 10 }, (_, i) => ({ skill: `S${i}`, nivel: "must" }));
    const raw = { ...base, veredicto: `${veredicto}x`, gaps };
    expect(outputSchemaFor(REF).safeParse(raw).success).toBe(false);
    const r = parse(raw);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.veredicto.length).toBeLessThanOrEqual(200);
    expect(r.data.gaps).toHaveLength(8);
  });

  it("no corta palabras ni deja espacios al final", () => {
    const out = normalizeEvaluationOutput({
      ...base,
      veredicto: `${"a".repeat(195)} palabralarga más`,
    });
    const v = (out as { veredicto: string }).veredicto;
    expect(v).toBe("a".repeat(195));
  });

  it("una palabra sin espacios más larga que el tope se corta en seco", () => {
    const v = (
      normalizeEvaluationOutput({ ...base, veredicto: "x".repeat(230) }) as { veredicto: string }
    ).veredicto;
    expect(v).toHaveLength(200);
  });

  it("recorta match_fuerte a 8", () => {
    const out = normalizeEvaluationOutput({
      ...base,
      match_fuerte: Array.from({ length: 12 }, (_, i) => `m${i}`),
    }) as { match_fuerte: string[] };
    expect(out.match_fuerte).toEqual(Array.from({ length: 8 }, (_, i) => `m${i}`));
  });

  it("el score se redondea a un decimal pero no se recorta: fuera de 0..10 falla el esquema estricto", () => {
    const score = (n: number) =>
      (normalizeEvaluationOutput({ ...base, score: n }) as { score: number }).score;
    expect(score(7.46)).toBe(7.5);
    expect(score(11)).toBe(11);
    expect(score(-2)).toBe(-2);
    expect(parse({ ...base, score: 7.46 }).success).toBe(true);
    expect(parse({ ...base, score: 11 }).success).toBe(false);
    expect(parse({ ...base, score: -2 }).success).toBe(false);
  });

  it("sin espacio donde cortar no parte un par sustituto", () => {
    const v = (
      normalizeEvaluationOutput({
        ...base,
        veredicto: `${"x".repeat(199)}\u{1F600}${"y".repeat(20)}`,
      }) as {
        veredicto: string;
      }
    ).veredicto;
    expect(v).toBe("x".repeat(199));
  });

  it("lo que no se puede normalizar sigue fallando cerrado", () => {
    const { veredicto: _v, ...sinVeredicto } = base;
    expect(parse(sinVeredicto).success).toBe(false);
    expect(parse({ ...base, score: "alto" }).success).toBe(false);
    expect(parse({ ...base, gaps: "ninguno" }).success).toBe(false);
    expect(parse({ ...base, veredicto: 42 }).success).toBe(false);
    expect(normalizeEvaluationOutput(null)).toBeNull();
    expect(normalizeEvaluationOutput("x")).toBe("x");
  });

  it("no toca lo que ya cumple, ni muta la entrada", () => {
    const raw = {
      ...base,
      gaps: Array.from({ length: 10 }, () => ({ skill: "a", nivel: "must" })),
    };
    const copy = structuredClone(raw);
    normalizeEvaluationOutput(raw);
    expect(raw).toEqual(copy);
    expect(normalizeEvaluationOutput(base)).toEqual(base);
  });
});

describe("evaluationWireFor", () => {
  const refs = [
    "evaluate_job@v1",
    "evaluate_job@v1.1",
    "evaluate_job@v1.3.1",
    "evaluate_job@v1.3.4",
    "evaluate_job@v1.4.0",
  ];

  it.each(refs)("el esquema que viaja al modelo no lleva límites (%s)", (ref) => {
    // `.int()` de zod 4 agrega los límites de entero seguro: no son del contrato, se descartan
    const json = JSON.stringify(
      z.toJSONSchema(evaluationWireFor(ref).schema, { io: "input" }),
    ).replace(/"(minimum|maximum)":-?9007199254740991/g, "");
    for (const key of ["maxLength", "maxItems", "minLength", "minItems", "minimum", "maximum"]) {
      expect(json).not.toContain(`"${key}"`);
    }
    // la forma sigue ahí: los campos requeridos viajan
    expect(json).toContain('"veredicto"');
  });

  it("el esquema estricto de siempre conserva sus límites", () => {
    const json = JSON.stringify(z.toJSONSchema(outputSchemaFor(REF), { io: "input" }));
    expect(json).toContain('"maxLength":200');
  });

  it.each(EVALUATE_JOB_SCHEMA_VERSIONS)(
    "outputSchemaFor y evaluationWireFor aceptan la misma versión (%s)",
    (version) => {
      const ref = `evaluate_job@${version}`;
      expect(() => outputSchemaFor(ref)).not.toThrow();
      expect(() => evaluationWireFor(ref)).not.toThrow();
    },
  );

  it("falla con una ref sin esquema, igual que outputSchemaFor", () => {
    expect(() => evaluationWireFor("evaluate_job@v9")).toThrow();
  });
});
