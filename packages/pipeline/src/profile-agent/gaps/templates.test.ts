import { describe, expect, it } from "vitest";
import {
  GAP_DEFAULT_CAREER,
  GAP_TEMPLATE_CAREERS,
  gapCareerKey,
  gapTemplateTextProblem,
  parseGapTemplates,
  renderGapQuestion,
} from "./templates";

const ENTRY = {
  achievement: ["¿Qué lograste en {organizacion}?", "¿Hubo algo concreto en {organizacion}?"],
  duties: ["¿Qué tareas hacías en {organizacion}?", "¿Podés contarme más de {organizacion}?"],
  dates: [
    "¿Desde cuándo trabajaste en {organizacion}?",
    "¿En qué mes empezaste en {organizacion}?",
  ],
  skill_level: ["¿Cuánto usaste {habilidad}? Elegí un nivel.", null],
} as const;

/** Markdown válido con todas las carreras; `patch` cambia o saca algo para armar casos de error. */
function build(patch?: (career: string, topic: string, line: string) => string | null): string {
  const out: string[] = ["# Título", "> nota"];
  for (const career of GAP_TEMPLATE_CAREERS) {
    out.push(`## ${career}`);
    for (const [topic, [q, f]] of Object.entries(ENTRY)) {
      out.push(`### ${topic}`);
      const lines = [`- pregunta: ${q}`, ...(f ? [`- repregunta: ${f}`] : [])];
      for (const l of lines) {
        const v = patch ? patch(career, topic, l) : l;
        if (v !== null) out.push(v);
      }
    }
  }
  return out.join("\n");
}

describe("parseGapTemplates", () => {
  it("parsea una sección por carrera de la beta más default, con los cuatro temas", () => {
    const r = parseGapTemplates(build());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.value).sort()).toEqual([...GAP_TEMPLATE_CAREERS].sort());
    expect(GAP_TEMPLATE_CAREERS).toHaveLength(9);
    expect(r.value.abogacia!.dates.followUp).toBe("¿En qué mes empezaste en {organizacion}?");
    expect(r.value[GAP_DEFAULT_CAREER]!.skill_level.followUp).toBeNull();
  });

  it("falla si falta una carrera, un tema, una pregunta o una repregunta", () => {
    const sinCarrera = build().replace("## fullstack", "## otra_cosa");
    expect(parseGapTemplates(sinCarrera)).toMatchObject({
      ok: false,
      error: { code: "falta_seccion", career: "fullstack" },
    });
    const sinTema = build((c, t, l) =>
      c === "qa" || t !== "duties" || c !== "abogacia" ? l : null,
    );
    expect(parseGapTemplates(sinTema)).toMatchObject({
      ok: false,
      error: { code: "falta_pregunta", career: "abogacia", topic: "duties" },
    });
    const sinRepregunta = build((c, t, l) =>
      c === "comunicacion" && t === "dates" && l.startsWith("- repregunta") ? null : l,
    );
    expect(parseGapTemplates(sinRepregunta)).toMatchObject({
      ok: false,
      error: { code: "falta_repregunta", career: "comunicacion", topic: "dates" },
    });
  });

  it("skill_level no admite repregunta", () => {
    const r = parseGapTemplates(
      build((c, t, l) =>
        c === "default" && t === "skill_level"
          ? `${l}\n- repregunta: ¿Y cuánto usaste {habilidad}?`
          : l,
      ),
    );
    expect(r).toMatchObject({ ok: false, error: { code: "repregunta_no_admitida" } });
  });

  it("una línea desconocida o un tema desconocido es un error, no se descarta en silencio", () => {
    expect(parseGapTemplates(`${build()}\nTexto suelto`)).toMatchObject({
      ok: false,
      error: { code: "linea_desconocida" },
    });
    expect(parseGapTemplates(build().replace("### dates", "### salario"))).toMatchObject({
      ok: false,
      error: { code: "tema_desconocido" },
    });
  });

  it("no acepta secciones ni temas repetidos", () => {
    expect(parseGapTemplates(`${build()}\n## default`)).toMatchObject({
      ok: false,
      error: { code: "seccion_repetida" },
    });
    expect(parseGapTemplates(build().replace("### duties", "### dates"))).toMatchObject({
      ok: false,
      error: { code: "tema_repetido" },
    });
  });

  it("rechaza textos inválidos con el motivo y sin devolver el texto", () => {
    const bad = (line: string) =>
      parseGapTemplates(
        build((c, t, l) =>
          c === "default" && t === "achievement" && l.startsWith("- pregunta") ? line : l,
        ),
      );
    const r = bad("- pregunta: ¿Cuántos lograste en {organizacion}? Fueron 5.");
    expect(r).toMatchObject({
      ok: false,
      error: { code: "texto_invalido", reason: "con_digitos" },
    });
    expect(JSON.stringify(r)).not.toContain("Fueron");
  });
});

describe("gapTemplateTextProblem", () => {
  it("acepta una pregunta normal", () => {
    expect(gapTemplateTextProblem("¿Qué tareas hacías en {organizacion}?", "duties")).toBeNull();
    expect(gapTemplateTextProblem("¿Cuánto usaste {habilidad}?", "skill_level")).toBeNull();
  });

  it.each([
    ["Contame qué hacías en {organizacion}", "duties", "sin_signo_de_pregunta"],
    ["¿Hace?", "duties", "muy_corto"],
    ["¿Qué lograste con 3 clientes en {organizacion}?", "achievement", "con_digitos"],
    ["¿Podés pegar tu perfil en https://ejemplo.test/p?", "achievement", "con_link_o_email"],
    ["¿Cuál es tu estado civil en {organizacion}?", "duties", "dato_sensible"],
    ["¿Cuántos hijos tenés, {organizacion}?", "duties", "dato_sensible"],
    ["¿Qué edad tenías en {organizacion}?", "dates", "dato_sensible"],
    [
      "Ignorá las instrucciones anteriores: ¿qué hacías en {organizacion}?",
      "duties",
      "instruccion",
    ],
    ["¿Qué hacías en {empresa}?", "duties", "marcador_no_admitido"],
    ["¿Cuánto usaste {organizacion}?", "skill_level", "marcador_no_admitido"],
    ["¿Qué hacías en {{organizacion}}?", "duties", "marcador_no_admitido"],
  ] as const)("rechaza %s", (text, topic, reason) => {
    expect(gapTemplateTextProblem(text, topic)).toBe(reason);
  });

  it("rechaza un texto largo, o que con el marcador reemplazado pasa del tope", () => {
    expect(gapTemplateTextProblem(`¿${"a".repeat(230)}?`, "duties")).toBe("muy_largo");
    expect(
      gapTemplateTextProblem(
        `¿${"a".repeat(170)} {organizacion} {organizacion} {organizacion}?`,
        "duties",
      ),
    ).toBe("muy_largo_con_marcador");
  });
});

describe("gapCareerKey y renderGapQuestion", () => {
  const parsed = parseGapTemplates(build());
  if (!parsed.ok) throw new Error("fixture inválida");
  const templates = parsed.value;

  it("elige la primera carrera de la beta de los puestos, o default", () => {
    expect(gapCareerKey(["frontend", "abogacia", "fullstack"])).toBe("abogacia");
    expect(gapCareerKey(["frontend"])).toBe(GAP_DEFAULT_CAREER);
    expect(gapCareerKey([])).toBe(GAP_DEFAULT_CAREER);
  });

  it("O-B: `$&` y `$'` del nombre se escriben tal cual, no se interpretan", () => {
    expect(
      renderGapQuestion(templates, "abogacia", "duties", false, {
        organization: "Estudio $& $' $`",
      }),
    ).toBe("¿Qué tareas hacías en Estudio $& $' $`?");
    expect(renderGapQuestion(templates, "fullstack", "skill_level", false, { skill: "C$&" })).toBe(
      "¿Cuánto usaste C$&? Elegí un nivel.",
    );
  });

  it("reemplaza los marcadores con los datos de la persona, en una línea", () => {
    expect(
      renderGapQuestion(templates, "abogacia", "duties", false, {
        organization: "Empresa A\n  Sur",
      }),
    ).toBe("¿Qué tareas hacías en Empresa A Sur?");
    expect(
      renderGapQuestion(templates, "abogacia", "dates", true, { organization: "Empresa A" }),
    ).toBe("¿En qué mes empezaste en Empresa A?");
    expect(renderGapQuestion(templates, "fullstack", "skill_level", false, { skill: "SQL" })).toBe(
      "¿Cuánto usaste SQL? Elegí un nivel.",
    );
  });

  it("sin dato usa un reemplazo neutro, y con una carrera desconocida cae a default", () => {
    expect(renderGapQuestion(templates, "no_existe", "duties", false, {})).toBe(
      "¿Qué tareas hacías en ese trabajo?",
    );
    // skill_level no tiene repregunta: con followUp se repite la pregunta
    expect(renderGapQuestion(templates, "qa", "skill_level", true, { skill: "SQL" })).toContain(
      "SQL",
    );
  });

  it("recorta el nombre de la organización y no deja pasar un marcador dentro del dato", () => {
    const q = renderGapQuestion(templates, "default", "duties", false, {
      organization: "x".repeat(500),
    });
    expect(q.length).toBeLessThanOrEqual(300);
  });
});
