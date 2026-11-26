import { describe, expect, it } from "vitest";
import {
  GLOSARIO,
  buscarTextoProhibido,
  estadoRequisitoVisible,
  riesgosVisibles,
} from "./glosario";

const codigos = (t: string, estricto = false) =>
  buscarTextoProhibido(t, { estricto }).map((h) => h.codigo);

describe("glosario (plan §3)", () => {
  it("tiene las nueve filas del plan y ninguna se contradice", () => {
    expect(GLOSARIO).toHaveLength(9);
    const dichos = GLOSARIO.map((g) => g.decir.toLowerCase());
    for (const g of GLOSARIO) {
      for (const no of g.noDecir) expect(dichos).not.toContain(no.toLowerCase());
    }
  });
});

describe("buscarTextoProhibido: frases de la regla 2", () => {
  it.each([
    ["Sumá una habilidad y quedás entre las mejores.", "predice_mejores"],
    ["Lo primero por lo que te descartarían: inglés", "descartarian"],
    ["Posible alta cantidad de candidatos", "alta_cantidad_candidatos"],
    ["Impide postular", "impide_postular"],
  ] as const)("%s", (texto, codigo) => {
    expect(codigos(texto)).toContain(codigo);
  });

  it("ignora mayúsculas y tildes", () => {
    expect(codigos("LO PRIMERO POR LO QUE TE DESCARTARIAN")).toContain("descartarian");
    expect(codigos("IMPIDE POSTULAR")).toContain("impide_postular");
  });
});

describe("buscarTextoProhibido: términos del glosario", () => {
  it("«Aplicada» como estado, skills, match y compatibilidad", () => {
    expect(codigos("Aplicada")).toEqual(["aplicada_estado"]);
    expect(codigos("Tus skills")).toEqual(["skills"]);
    expect(codigos("Un match alto")).toEqual(["match"]);
    expect(codigos("Compatibilidad del 80 %")).toEqual(["compatibilidad"]);
  });

  it("«te falta» y «no cumple» (también en plural y con voseo)", () => {
    expect(codigos("Te falta experiencia")).toEqual(["te_falta"]);
    expect(codigos("Te faltan dos requisitos")).toEqual(["te_falta"]);
    expect(codigos("No cumple con el requisito")).toEqual(["no_cumple"]);
    expect(codigos("No cumplís con el requisito")).toEqual(["no_cumple"]);
  });

  it("los textos del glosario pasan limpios", () => {
    for (const t of [
      "Afinidad alta",
      "Ya me postulé",
      "Coincide",
      "Sin confirmar",
      "No coincide: residencia en EE. UU.",
      "Habilidades",
      "Guardada",
      "Sin evaluar",
      "No especificado",
      "Esta comparación usa la información del aviso y de tu perfil.",
    ]) {
      expect(codigos(t, true), t).toEqual([]);
    }
  });

  it("el modo estricto suma los términos que solo rigen para los textos nuevos", () => {
    expect(codigos("Sin datos")).toEqual([]);
    expect(codigos("Sin datos", true)).toEqual(["sin_datos"]);
    expect(codigos("Estimado", true)).toEqual(["estimado"]);
    expect(codigos("Tu aptitud", true)).toEqual([]);
    expect(codigos("Tus aptitudes", true)).toEqual(["aptitudes"]);
    expect(codigos("Falta confirmar el título", true)).toContain("falta_confirmar");
    expect(codigos("Tu favorita", true)).toEqual(["favorita"]);
  });

  it("devuelve el fragmento encontrado", () => {
    expect(buscarTextoProhibido("Mirá tus skills acá")[0]).toEqual({
      codigo: "skills",
      fragmento: "skills",
    });
  });
});

describe("estadoRequisitoVisible: «sin confirmar» no es «no coincide» (regla 1)", () => {
  it("coincide cuando la tabla dice cumple", () => {
    expect(estadoRequisitoVisible("cumple", true)).toBe("coincide");
    expect(estadoRequisitoVisible("cumple", false)).toBe("coincide");
  });

  it("no coincide solo si el perfil tiene un dato explícito distinto", () => {
    expect(estadoRequisitoVisible("no_cumple", true)).toBe("no_coincide");
  });

  it("no_cumple sin dato del perfil queda sin confirmar", () => {
    expect(estadoRequisitoVisible("no_cumple", false)).toBe("sin_confirmar");
  });

  it("no_se_sabe y lo que no se entiende fallan cerrado a sin confirmar", () => {
    expect(estadoRequisitoVisible("no_se_sabe", true)).toBe("sin_confirmar");
    expect(estadoRequisitoVisible("otra_cosa", true)).toBe("sin_confirmar");
  });
});

describe("riesgosVisibles: «muchos candidatos» solo con el número del aviso", () => {
  it("sin candidatesCount se saca, venga como venga escrito", () => {
    expect(riesgosVisibles(["Muchos candidatos", "Salario no publicado"], null)).toEqual([
      "Salario no publicado",
    ]);
    expect(riesgosVisibles(["muchos candidatos (168)"], undefined)).toEqual([]);
    expect(riesgosVisibles(["Muchos postulantes"], 0)).toEqual([]);
  });

  it("con candidatesCount se muestra con el número del aviso, una sola vez", () => {
    expect(
      riesgosVisibles(["Muchos candidatos (999)", "Empresa desconocida", "muchos candidatos"], 168),
    ).toEqual(["Muchos candidatos: 168", "Empresa desconocida"]);
  });

  it("lo demás pasa igual y en el mismo orden", () => {
    expect(riesgosVisibles(["B", "A"], null)).toEqual(["B", "A"]);
    expect(riesgosVisibles([], 10)).toEqual([]);
  });
});
