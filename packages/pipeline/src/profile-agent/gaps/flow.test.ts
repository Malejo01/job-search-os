import { describe, expect, it } from "vitest";
import { profileAgentStateSchema, initialProfileAgentState } from "../schemas";
import { detectGaps, type GapHistoryRow } from "./detect";
import {
  closeGap,
  gapFollowUpsAsked,
  initialGapState,
  nextGapQuestion,
  openGapFollowUp,
} from "./flow";
import { GAP_TEMPLATE_CAREERS, parseGapTemplates } from "./templates";

const ID_A = "00000000-0000-4000-8000-00000000000a";
const ID_B = "00000000-0000-4000-8000-00000000000b";

function templates() {
  const lines: string[] = [];
  for (const c of GAP_TEMPLATE_CAREERS) {
    lines.push(
      `## ${c}`,
      "### achievement",
      "- pregunta: ¿Qué lograste en {organizacion}?",
      "- repregunta: ¿Hubo algo concreto en {organizacion}?",
      "### duties",
      "- pregunta: ¿Qué tareas hacías en {organizacion}?",
      "- repregunta: ¿Podés contarme más de {organizacion}?",
      "### dates",
      "- pregunta: ¿Desde cuándo trabajaste en {organizacion}?",
      "- repregunta: ¿En qué mes empezaste en {organizacion}?",
      "### skill_level",
      "- pregunta: ¿Cuánto usaste {habilidad}? Elegí un nivel.",
    );
  }
  const r = parseGapTemplates(lines.join("\n"));
  if (!r.ok) throw new Error("fixture inválida");
  return r.value;
}

const rows: GapHistoryRow[] = [
  {
    id: ID_A,
    kind: "trabajo",
    organization: "Empresa A",
    title: "Analista",
    startMonth: null,
    endMonth: null,
    bullets: ["Armaba reportes semanales para ventas", "Bajé costos un 10%"],
  },
  {
    id: ID_B,
    kind: "trabajo",
    organization: "Empresa B",
    title: "Asistente",
    startMonth: "2020-01",
    endMonth: "2021-01",
    bullets: [],
  },
];
const gaps = detectGaps(rows, [{ slug: "sql", name: "SQL", level: 1 }]);

describe("estado de la charla de huecos", () => {
  it("cerrar un tema es idempotente y limpia `current`", () => {
    let s = openGapFollowUp(initialGapState(), "k:dates");
    expect(s.current).toBe("k:dates");
    s = closeGap(closeGap(s, "k:dates"), "k:dates");
    expect(s.answered).toEqual(["k:dates"]);
    expect(s.current).toBeNull();
  });

  it("cada repregunta suma una y no pasa de dos", () => {
    let s = initialGapState();
    for (let i = 0; i < 5; i++) s = openGapFollowUp(s, "k:duties");
    expect(gapFollowUpsAsked(s, "k:duties")).toBe(2);
    expect(gapFollowUpsAsked({ ...s, followUps: { "k:duties": -3 } }, "k:duties")).toBe(0);
    expect(gapFollowUpsAsked(initialGapState(), "otro")).toBe(0);
  });

  it("el estado que viaja entra en el esquema del contrato", () => {
    const state = openGapFollowUp(closeGap(initialGapState(), "k:dates"), "k:duties");
    expect(
      profileAgentStateSchema.safeParse({ ...initialProfileAgentState(), gaps: state }).success,
    ).toBe(true);
  });
});

describe("nextGapQuestion", () => {
  const tpl = templates();

  it("devuelve la primera pregunta con la plantilla de la carrera y los temas que quedan", () => {
    const next = nextGapQuestion({
      templates: tpl,
      career: "abogacia",
      gaps,
      state: initialGapState(),
    });
    expect(next?.ref.topic).toBe("dates");
    expect(next?.question).toEqual({
      key: next!.ref.key,
      topic: "dates",
      question: "¿Desde cuándo trabajaste en Empresa A?",
      followUp: 0,
      remaining: gaps.length,
    });
  });

  it("con una repregunta abierta usa el texto de la repregunta", () => {
    const first = nextGapQuestion({
      templates: tpl,
      career: "default",
      gaps,
      state: initialGapState(),
    })!;
    const state = openGapFollowUp(initialGapState(), first.ref.key);
    const again = nextGapQuestion({ templates: tpl, career: "default", gaps, state })!;
    expect(again.ref.key).toBe(first.ref.key);
    expect(again.question.followUp).toBe(1);
    expect(again.question.question).toBe("¿En qué mes empezaste en Empresa A?");
  });

  it("recorre todos los temas, termina con la skill y después no hay más", () => {
    let state = initialGapState();
    const seen: string[] = [];
    for (let i = 0; i < 20; i++) {
      const n = nextGapQuestion({ templates: tpl, career: "fullstack", gaps, state });
      if (!n) break;
      seen.push(n.ref.topic);
      state = closeGap(state, n.ref.key);
    }
    expect(seen).toEqual(["dates", "duties", "achievement", "skill_level"]);
    expect(nextGapQuestion({ templates: tpl, career: "fullstack", gaps, state })).toBeNull();
  });

  it("la pregunta de una skill lleva el nombre de la skill", () => {
    const only = detectGaps([], [{ slug: "sql", name: "SQL", level: 1 }]);
    const n = nextGapQuestion({
      templates: tpl,
      career: "default",
      gaps: only,
      state: initialGapState(),
    });
    expect(n?.question.question).toBe("¿Cuánto usaste SQL? Elegí un nivel.");
  });
});
