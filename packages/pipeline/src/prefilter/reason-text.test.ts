import { describe, expect, it } from "vitest";
import { prefilterReasonText } from "./reason-text";

describe("prefilterReasonText", () => {
  it("modalidad_no_remota, con o sin detail", () => {
    const frase = "Es híbrida o presencial, y no aceptás esa modalidad.";
    expect(prefilterReasonText("modalidad_no_remota: modalidad hibrido")).toBe(frase);
    expect(prefilterReasonText("modalidad_no_remota: título: AI Engineer (Híbrido)")).toBe(frase);
    expect(prefilterReasonText("modalidad_no_remota")).toBe(frase);
  });

  it("idioma_no_aceptado: nombra el idioma del aviso", () => {
    expect(prefilterReasonText("idioma_no_aceptado: aviso en inglés")).toBe(
      "El aviso está en inglés, y elegiste ofertas solo en español.",
    );
    expect(prefilterReasonText("idioma_no_aceptado: aviso en español")).toBe(
      "El aviso está en español, y elegiste ofertas solo en inglés.",
    );
    expect(prefilterReasonText("idioma_no_aceptado")).toBe(
      "El aviso está en un idioma que no elegiste.",
    );
  });

  it("disciplina_distinta: usa lo que va entre comillas, sin comillas ni paréntesis del detail", () => {
    expect(prefilterReasonText("disciplina_distinta: keyword 'seo' en el título")).toBe(
      "El puesto es de otra área (seo).",
    );
    expect(prefilterReasonText("disciplina_distinta: título fuera de IT: 'cajer'")).toBe(
      "El puesto es de otra área (cajer).",
    );
    expect(prefilterReasonText("disciplina_distinta")).toBe("El puesto es de otra área.");
    expect(prefilterReasonText("disciplina_distinta: sin comillas")).toBe(
      "El puesto es de otra área.",
    );
  });

  it("badge_aptitudes: con y sin el número", () => {
    expect(prefilterReasonText("badge_aptitudes: aptitudes 33% < 40%")).toBe(
      "Coincidís con pocas de las aptitudes que pide el aviso (33 %).",
    );
    expect(prefilterReasonText("badge_aptitudes")).toBe(
      "Coincidís con pocas de las aptitudes que pide el aviso.",
    );
  });

  it("titulo_blocklist: recorta espacios de la palabra", () => {
    expect(prefilterReasonText("titulo_blocklist: 'vp ' en el título")).toBe(
      "El título incluye «vp», que está en los títulos que excluís en tus criterios.",
    );
    expect(prefilterReasonText("titulo_blocklist: 'director' en el título")).toBe(
      "El título incluye «director», que está en los títulos que excluís en tus criterios.",
    );
  });

  it("motivo desconocido", () => {
    expect(prefilterReasonText("algo_nuevo: x")).toBe("No pasó el filtro inicial.");
  });

  it("null, undefined o vacío → null", () => {
    expect(prefilterReasonText(null)).toBeNull();
    expect(prefilterReasonText(undefined)).toBeNull();
    expect(prefilterReasonText("")).toBeNull();
    expect(prefilterReasonText("   ")).toBeNull();
  });

  it("detail con caracteres raros: se devuelve tal cual, sin romper", () => {
    expect(prefilterReasonText("disciplina_distinta: keyword '<b>&\"x\"</b>' en el título")).toBe(
      'El puesto es de otra área (<b>&"x"</b>).',
    );
    expect(prefilterReasonText("titulo_blocklist: '«»:;\\n' en el título")).toBe(
      "El título incluye ««»:;\\n», que está en los títulos que excluís en tus criterios.",
    );
  });
});
