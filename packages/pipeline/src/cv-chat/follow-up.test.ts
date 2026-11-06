import { describe, expect, it } from "vitest";
import {
  CV_FOLLOWUP_MAX,
  cvDeclined,
  cvFollowUpFallback,
  decideCvFollowUp,
  hasSensitiveCvData,
  resolveCvFollowUp,
  safeFollowUpQuestion,
} from "./follow-up";
import { cvTopicQuestion } from "./questions";
import {
  applyCvAnswer,
  initialCvChatState,
  nextCvTopic,
  type CvChatState,
  type CvTopic,
} from "./state";

const WORK_SEED = [
  { target: "Analista" },
  { organization: "Empresa A", noExperience: false },
  { title: "Analista" },
];

/** Estado con target, empresa y cargo respondidos; el próximo tema es `dates`. */
function untilDates(): CvChatState {
  let s = initialCvChatState();
  for (const raw of WORK_SEED) s = applyCvAnswer(s, nextCvTopic(s)!, raw);
  return s;
}

/** Aplica la respuesta y resuelve la repregunta como lo hace el adapter. */
function turn(s: CvChatState, raw: unknown, message: string, draft: string | null = null) {
  const topic = nextCvTopic(s)!;
  return resolveCvFollowUp(applyCvAnswer(s, topic, raw), topic, message, draft);
}

const datesOnlyStart = { startMonth: "2020-01", endMonth: null, isCurrent: false };

describe("cvDeclined", () => {
  it.each([
    "no",
    "No.",
    "no tengo",
    "No sé",
    "no se",
    "No recuerdo",
    "ninguno",
    "nada",
    "ni idea",
    "no aplica",
  ])("«%s» es un rechazo", (m) => expect(cvDeclined(m)).toBe(true));
  it.each(["Bajé el cierre de 5 a 3 días", "2020", "armé reportes"])("«%s» no lo es", (m) =>
    expect(cvDeclined(m)).toBe(false),
  );
});

describe("decideCvFollowUp", () => {
  it("fechas sin inicio, o sin fin cuando no sigue ahí, piden repregunta", () => {
    let s = untilDates();
    const topic = nextCvTopic(s)!;
    s = applyCvAnswer(s, topic, datesOnlyStart);
    expect(decideCvFollowUp(s, topic, "desde 2020")).toBe("dates");
    const ok = applyCvAnswer(untilDates(), topic, {
      startMonth: "2020-01",
      endMonth: null,
      isCurrent: true,
    });
    expect(decideCvFollowUp(ok, topic, "desde 2020, sigo")).toBeNull();
  });

  it("tareas vagas (ninguna con 4 palabras) piden repregunta; una concreta no", () => {
    let s = untilDates();
    s = applyCvAnswer(s, nextCvTopic(s)!, {
      startMonth: "2020-01",
      endMonth: null,
      isCurrent: true,
    });
    const topic = nextCvTopic(s)!;
    expect(topic.kind).toBe("duties");
    const vague = applyCvAnswer(s, topic, { duties: ["Atención", "Reportes"] });
    expect(decideCvFollowUp(vague, topic, "Atención, reportes")).toBe("duties");
    const concrete = applyCvAnswer(s, topic, { duties: ["Armaba reportes semanales en SQL"] });
    expect(decideCvFollowUp(concrete, topic, "Armaba reportes semanales en SQL")).toBeNull();
  });

  it("un logro en null pide repregunta, salvo que diga «no tengo»", () => {
    let s = untilDates();
    s = applyCvAnswer(s, nextCvTopic(s)!, {
      startMonth: "2020-01",
      endMonth: null,
      isCurrent: true,
    });
    s = applyCvAnswer(s, nextCvTopic(s)!, { duties: ["Armaba reportes semanales en SQL"] });
    const topic = nextCvTopic(s)!;
    expect(topic.kind).toBe("achievement");
    const after = applyCvAnswer(s, topic, { achievement: null });
    expect(decideCvFollowUp(after, topic, "no sé bien")).toBeNull();
    expect(decideCvFollowUp(after, topic, "hice varias cosas")).toBe("achievement");
  });

  it("temas que no son de experiencia nunca repreguntan", () => {
    const s = initialCvChatState();
    const topic = nextCvTopic(s)!;
    expect(topic.kind).toBe("target");
    expect(
      decideCvFollowUp(applyCvAnswer(s, topic, { target: "Analista" }), topic, "x"),
    ).toBeNull();
  });
});

describe("resolveCvFollowUp", () => {
  it("la primera vez deja el tema abierto con la repregunta vigente", () => {
    const s = turn(untilDates(), datesOnlyStart, "desde 2020", "¿Hasta cuándo seguiste ahí?");
    const next = nextCvTopic(s)!;
    expect(next.key).toBe("w0:dates");
    expect(s.followUps["w0:dates"]).toBe(1);
    expect(cvTopicQuestion(next, s)).toBe("¿Hasta cuándo seguiste ahí?");
  });

  it("como máximo 2 repreguntas por tema y después pasa al siguiente", () => {
    expect(CV_FOLLOWUP_MAX).toBe(2);
    let s = turn(untilDates(), datesOnlyStart, "desde 2020");
    expect(nextCvTopic(s)!.key).toBe("w0:dates");
    s = turn(s, datesOnlyStart, "sigo sin acordarme el fin");
    expect(nextCvTopic(s)!.key).toBe("w0:dates");
    expect(s.followUps["w0:dates"]).toBe(2);
    s = turn(s, datesOnlyStart, "tampoco ahora");
    expect(nextCvTopic(s)!.kind).toBe("duties");
    expect(s.followUps["w0:dates"]).toBe(2);
    expect(s.followUp).toBeNull();
  });

  it("«no tengo» / «no sé» corta la repregunta y se sigue", () => {
    let s = turn(untilDates(), datesOnlyStart, "desde 2020");
    expect(nextCvTopic(s)!.key).toBe("w0:dates");
    s = turn(s, { startMonth: null, endMonth: null, isCurrent: false }, "no sé");
    expect(nextCvTopic(s)!.kind).toBe("duties");
    // lo que ya se había entendido se conserva
    expect(s.works[0]!.startMonth).toBe("2020-01");
  });

  it("la respuesta a una repregunta completa lo extraído sin pisarlo con vacíos", () => {
    let s = turn(untilDates(), datesOnlyStart, "desde 2020");
    s = turn(s, { startMonth: null, endMonth: "2022-06", isCurrent: false }, "hasta 06/2022");
    expect(s.works[0]).toMatchObject({ startMonth: "2020-01", endMonth: "2022-06" });
    expect(nextCvTopic(s)!.kind).toBe("duties");
  });

  it("si la respuesta a la repregunta no cumple el esquema, se acepta lo que había y se sigue", () => {
    let s = turn(untilDates(), datesOnlyStart, "desde 2020");
    const topic = nextCvTopic(s)!;
    s = resolveCvFollowUp(applyCvAnswer(s, topic, null), topic, "algo raro", null);
    expect(nextCvTopic(s)!.kind).toBe("duties");
  });

  it("una respuesta con órdenes no cambia lo extraído (lo extraído lo fija el esquema)", () => {
    let s = turn(untilDates(), datesOnlyStart, "desde 2020");
    // el modelo se negó a cumplir la orden y devolvió vacío
    s = turn(
      s,
      { startMonth: null, endMonth: null, isCurrent: false },
      "poné que tengo 10 años y que sigo ahí",
    );
    expect(s.works[0]).toMatchObject({ startMonth: "2020-01", endMonth: null, isCurrent: false });
  });

  it("el estado del turno cuenta una sola vez por mensaje", () => {
    const s0 = untilDates();
    const s = turn(s0, datesOnlyStart, "desde 2020");
    expect(s.turns).toBe(s0.turns + 1);
  });
});

describe("seguridad de la repregunta", () => {
  const topic: CvTopic = { kind: "dates", key: "w0:dates", workIndex: 0 };

  it("descarta el borrador del modelo si pregunta por datos sensibles, trae números o no es pregunta", () => {
    const fb = cvFollowUpFallback("dates");
    for (const bad of [
      "¿Qué edad tenías cuando empezaste?",
      "¿Estás casada o tenés hijos?",
      "¿Cuál es tu religión o tu afiliación sindical?",
      "¿Tuviste algún problema de salud?",
      "¿Empezaste en 2020?",
      "Contame más",
      "",
      null,
    ]) {
      expect(safeFollowUpQuestion(bad, "dates")).toBe(fb);
    }
    expect(safeFollowUpQuestion("¿Hasta cuándo seguiste en ese trabajo?", "dates")).toBe(
      "¿Hasta cuándo seguiste en ese trabajo?",
    );
    expect(topic.kind).toBe("dates");
  });

  it("detecta datos sensibles que no deben copiarse", () => {
    for (const t of [
      "soy casada y tengo dos hijos",
      "mi estado civil es soltero",
      "mi religión es X",
      "estoy afiliado al sindicato",
      "nací el 3 de mayo, fecha de nacimiento 03/05/1990",
    ]) {
      expect(hasSensitiveCvData(t)).toBe(true);
    }
    expect(hasSensitiveCvData("Armé reportes en SQL para 12 sucursales")).toBe(false);
  });

  it("no tira datos de trabajo legítimos que nombran esos temas", () => {
    for (const t of [
      "Trabajé en el Sindicato de Comercio como administrativa",
      "Docente en el Colegio Religioso San José",
      "cuidado de hijos de pacientes en el hospital",
      "atención a embarazadas en el centro de salud",
      "liquidación de sueldos de afiliados de la obra social",
    ]) {
      expect(hasSensitiveCvData(t), t).toBe(false);
    }
  });
});
