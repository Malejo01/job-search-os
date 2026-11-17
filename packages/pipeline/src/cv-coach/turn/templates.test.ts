import { describe, expect, it } from "vitest";
import { CV_ISSUE_TYPES } from "../issues";
import {
  coachFallbackTextProblem,
  COACH_QUESTION_MAX_CHARS,
  parseCoachFallbacks,
  renderCoachFallback,
} from "./templates";
import { realFallbacks, realFallbacksBody } from "./test-fixtures";

/** Markdown mínimo válido: solo la variante `puesto` en cada tipo. */
function minimal(patch?: (line: string) => string | null): string {
  const out: string[] = ["# Título", "> nota"];
  for (const t of CV_ISSUE_TYPES) {
    for (const l of [
      `## ${t}`,
      "### puesto",
      "- pregunta: ¿Qué querés contar para {puesto}?",
      "- repregunta: ¿Algo más para {puesto}?",
    ]) {
      const v = patch ? patch(l) : l;
      if (v !== null) out.push(v);
    }
  }
  return out.join("\n");
}

describe("plantillas de respaldo del coach (cv_coach_fallbacks.v1.md)", () => {
  it("el archivo real valida: un tipo por cada CV_ISSUE_TYPES, todos con la variante puesto", () => {
    const f = realFallbacks();
    expect(Object.keys(f).sort()).toEqual([...CV_ISSUE_TYPES].sort());
    for (const t of CV_ISSUE_TYPES) {
      expect(f[t].puesto.question.length).toBeGreaterThan(10);
      expect(f[t].puesto.followUp.length).toBeGreaterThan(10);
    }
    // los tipos que apuntan a un trabajo o a un proyecto tienen su variante, para nombrar el ítem
    expect(f.logro_sin_resultado.organizacion).toBeDefined();
    expect(f.logro_sin_resultado.proyecto).toBeDefined();
    expect(f.proyecto_sin_stack_o_link.proyecto).toBeDefined();
    expect(f.brecha_con_puesto.habilidad).toBeDefined();
    expect(f.fecha_faltante.organizacion).toBeDefined();
  });

  it("el mínimo valida y sus errores se informan sin el texto", () => {
    expect(parseCoachFallbacks(minimal()).ok).toBe(true);
    expect(parseCoachFallbacks(minimal((l) => (l === "## tarea_vaga" ? null : l)))).toMatchObject({
      ok: false,
    });
    const unknown = parseCoachFallbacks(`${minimal()}\n## otro_tipo`);
    expect(unknown).toMatchObject({ ok: false, error: { code: "tipo_desconocido" } });
    const loose = parseCoachFallbacks(`${minimal()}\ntexto suelto`);
    expect(loose).toMatchObject({ ok: false, error: { code: "linea_desconocida" } });
    const noFollow = parseCoachFallbacks(minimal((l) => (l.startsWith("- repregunta") ? null : l)));
    expect(noFollow).toMatchObject({ ok: false, error: { code: "falta_repregunta" } });
  });

  it("la variante puesto es obligatoria en cada tipo", () => {
    const body = minimal((l) => (l === "### puesto" ? "### organizacion" : l)).replaceAll(
      "{puesto}",
      "{organizacion}",
    );
    expect(parseCoachFallbacks(body)).toMatchObject({
      ok: false,
      error: { code: "falta_variante_puesto" },
    });
  });

  it("rechaza dígitos, links, datos sensibles, instrucciones y marcadores ajenos o ausentes", () => {
    expect(
      coachFallbackTextProblem("¿Qué lograste en {organizacion} en 2024?", "organizacion"),
    ).toBe("con_digitos");
    expect(coachFallbackTextProblem("¿Lo subiste a ejemplo.com, {proyecto}?", "proyecto")).toBe(
      "con_link_o_email",
    );
    expect(coachFallbackTextProblem("¿Cuál es tu estado civil para {puesto}?", "puesto")).toBe(
      "dato_sensible",
    );
    expect(coachFallbackTextProblem("¿Tenés hijos? Contame para {puesto}.", "puesto")).toBe(
      "dato_sensible",
    );
    expect(coachFallbackTextProblem("¿Qué lograste en {organizacion}?", "proyecto")).toBe(
      "marcador_no_admitido",
    );
    expect(coachFallbackTextProblem("¿Qué lograste en ese trabajo?", "organizacion")).toBe(
      "sin_marcador",
    );
    expect(
      coachFallbackTextProblem("Contame qué lograste en {organizacion}.", "organizacion"),
    ).toBe("sin_signo_de_pregunta");
    expect(coachFallbackTextProblem("¿Qué lograste en {organizacion}?", "organizacion")).toBeNull();
  });

  it("render: usa la variante del ancla, cae a puesto si falta, y nunca deja un marcador", () => {
    const f = realFallbacks();
    const a = renderCoachFallback(
      f,
      "logro_sin_resultado",
      { variant: "organizacion", value: "Empresa A" },
      false,
      "Analista de datos",
    );
    expect(a).toContain("Empresa A");
    const b = renderCoachFallback(
      f,
      "resumen_generico",
      { variant: "organizacion", value: "Empresa A" },
      true,
      "Analista de datos",
    );
    expect(b).toContain("Analista de datos");
    expect(b).not.toContain("Empresa A");
    const c = renderCoachFallback(
      f,
      "proyecto_sin_stack_o_link",
      { variant: "proyecto", value: null },
      false,
      "",
    );
    expect(c).toContain("ese proyecto");
    for (const text of [a, b, c]) {
      expect(text).not.toMatch(/[{}]/);
      expect(text.length).toBeLessThanOrEqual(COACH_QUESTION_MAX_CHARS);
    }
  });

  it("render: un nombre con `$&` no se interpreta y uno largo se recorta", () => {
    const f = realFallbacks();
    const q = renderCoachFallback(
      f,
      "tarea_vaga",
      { variant: "organizacion", value: `Empresa $& ${"x".repeat(200)}` },
      false,
      "Analista",
    );
    expect(q).toContain("Empresa $&");
    expect(q.length).toBeLessThanOrEqual(COACH_QUESTION_MAX_CHARS);
  });

  it("ninguna pregunta del archivo real tiene dígitos", () => {
    const lines = realFallbacksBody()
      .split("\n")
      .filter((l) => /^- (pregunta|repregunta):/.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(CV_ISSUE_TYPES.length * 2);
    for (const l of lines) expect(l).not.toMatch(/\d/);
  });
});
