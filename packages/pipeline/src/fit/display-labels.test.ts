import { describe, expect, it } from "vitest";
import type { Checklist, ChecklistItem } from "../evaluator/checklist";
import {
  contradictsRequirement,
  countriesText,
  disciplineName,
  gapText,
  roleAskText,
  translateChecklist,
  translateChecklistItem,
  visibleRisks,
  withMustGaps,
} from "./display-labels";

const item = (over: Partial<ChecklistItem>): ChecklistItem => ({
  id: "x",
  kind: "estructurado",
  nivel: "must",
  pide: "x",
  evidencia: null,
  tenes: null,
  status: "cumple",
  fuente: { pide: "fuente", tenes: "perfil" },
  bloquea: false,
  ...over,
});

const checklist = (items: ChecklistItem[]): Checklist => ({
  items,
  must: {
    cumple: items.filter((i) => i.nivel === "must" && i.status === "cumple").length,
    no_cumple: items.filter((i) => i.nivel === "must" && i.status === "no_cumple").length,
    no_se_sabe: 0,
  },
  deseable: { cumple: 0, no_cumple: 0, no_se_sabe: 0 },
  parcial: false,
  descarte_rapido: null,
});

describe("valores internos → texto", () => {
  it("«*» es cualquier país", () => {
    expect(countriesText(["*"])).toBe("cualquier país");
    expect(countriesText(["AR", "*"])).toBe("cualquier país");
    expect(countriesText(["AR", "UY"])).toBe("AR, UY");
  });

  it("disciplinas y carreras con su nombre; un valor nuevo no muestra guiones bajos", () => {
    expect(disciplineName("project_management")).toBe("Gestión de proyectos");
    expect(disciplineName("finanzas_contabilidad")).toBe("Finanzas y contabilidad");
    expect(disciplineName("rubro_nuevo")).toBe("rubro nuevo");
  });

  it("«otra» no sale como «Puesto de otra»", () => {
    expect(roleAskText("otra")).toBe("Puesto de un área sin clasificar");
    expect(roleAskText("backend")).toBe("Puesto de backend");
  });

  it("«(must)» es «(excluyente)»", () => {
    expect(gapText("AWS (must)")).toBe("AWS (excluyente)");
    expect(gapText("Rust (nice to have)")).toBe("Rust (deseable)");
    expect(gapText("Sin marca")).toBe("Sin marca");
  });
});

describe("lo ya guardado se traduce al leer", () => {
  it("país, disciplina y disciplinas aceptadas", () => {
    expect(translateChecklistItem(item({ id: "pais", pide: "Disponible en *" })).pide).toBe(
      "Disponible en cualquier país",
    );
    expect(translateChecklistItem(item({ id: "pais", pide: "Disponible en AR, UY" })).pide).toBe(
      "Disponible en AR, UY",
    );
    const d = translateChecklistItem(
      item({
        id: "disciplina",
        pide: "Puesto de otra",
        tenes: "backend, project management, finanzas contabilidad",
      }),
    );
    expect(d.pide).toBe("Puesto de un área sin clasificar");
    expect(d.tenes).toBe("Backend, Gestión de proyectos, Finanzas y contabilidad");
  });

  it("no toca los demás ítems y traduce también el descarte rápido", () => {
    const anos = item({ id: "anos", pide: "3 años" });
    expect(translateChecklistItem(anos)).toBe(anos);
    const c = translateChecklist({
      ...checklist([]),
      descarte_rapido: item({ id: "disciplina", pide: "Puesto de otra" }),
    });
    expect(c.descarte_rapido?.pide).toBe("Puesto de un área sin clasificar");
  });
});

describe("Requisitos cuenta los excluyentes de la evaluación", () => {
  const base = checklist([item({ id: "anos", pide: "3 años" }), item({ id: "pais", pide: "AR" })]);

  it("nunca «cumplís todo» con un excluyente en «Te falta»", () => {
    const c = withMustGaps(base, ["AWS (must)", "Kubernetes (must)", "Rust (deseable)"]);
    expect(c.must).toEqual({ cumple: 2, no_cumple: 2, no_se_sabe: 0 });
    expect(c.items.filter((i) => i.status === "no_cumple").map((i) => i.pide)).toEqual([
      "AWS",
      "Kubernetes",
    ]);
  });

  it("también con el texto ya traducido", () => {
    expect(withMustGaps(base, ["AWS (excluyente)"]).must.no_cumple).toBe(1);
  });

  it("no duplica una skill que el checklist ya evalúa", () => {
    const withSkill = checklist([
      item({ id: "skill:aws", kind: "skill", pide: "Menciona AWS", status: "no_cumple" }),
    ]);
    expect(withMustGaps(withSkill, ["AWS (must)"])).toBe(withSkill);
  });

  it("sin gaps excluyentes devuelve el mismo checklist", () => {
    expect(withMustGaps(base, ["Pide más años en la nube"])).toBe(base);
  });
});

describe("un riesgo que contradice un excluyente no va en «se ven, no frenan»", () => {
  const items = [
    item({ id: "anos", status: "cumple" }),
    item({ id: "ingles", status: "no_cumple" }),
    item({ id: "pais", status: "no_se_sabe" }),
  ];

  it("años cumplido contradice un riesgo de años", () => {
    expect(contradictsRequirement("Piden 8 años de experiencia", items)).toBe(true);
  });

  it("inglés que no se cumple es un freno: va en «Te falta», no en riesgos", () => {
    expect(contradictsRequirement("El aviso pide inglés avanzado", items)).toBe(true);
  });

  it("si no sabemos (país), el riesgo se queda", () => {
    expect(
      contradictsRequirement(
        "El aviso no dice desde qué países contrata: confirmalo antes de postular",
        items,
      ),
    ).toBe(false);
  });

  it("riesgos sin tema o de un deseable se quedan", () => {
    expect(visibleRisks(["muchos postulantes"], items)).toEqual(["muchos postulantes"]);
    expect(
      visibleRisks(["Pide inglés"], [item({ id: "ingles", nivel: "deseable", status: "cumple" })]),
    ).toEqual(["Pide inglés"]);
  });

  it("sin checklist no se filtra nada", () => {
    expect(visibleRisks(["Piden 8 años"], null)).toEqual(["Piden 8 años"]);
  });
});
