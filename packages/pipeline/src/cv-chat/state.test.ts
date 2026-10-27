import { describe, expect, it } from "vitest";
import { buildCvUnderstoodCard } from "./card";
import {
  applyCvAnswer,
  cvChatCloseReason,
  cvChatHistory,
  cvChecklistProgress,
  CV_CHAT_MAX_TURNS,
  cvWorkSources,
  initialCvChatState,
  nextCvTopic,
  skipCvTopic,
  type CvChatState,
} from "./state";

/** Responde el tema pendiente con la respuesta guionada de su tipo. */
function answer(s: CvChatState, raw: unknown): CvChatState {
  const t = nextCvTopic(s);
  if (!t) throw new Error("sin tema");
  return applyCvAnswer(s, t, raw);
}

const script: unknown[] = [
  { target: "Analista de datos" },
  { organization: "Empresa A", noExperience: false },
  { title: "Analista" },
  { startMonth: "2021-03", endMonth: null, isCurrent: true },
  { duties: ["armé reportes en SQL"] },
  { achievement: "bajé el cierre de 5 a 3 días" },
  { more: false },
  {
    entries: [
      {
        institution: "Universidad A",
        title: "Lic. en Estadística",
        startMonth: null,
        endMonth: "2019-12",
      },
    ],
  },
  { entries: [] },
  { skills: ["SQL", "sql", "Excel"] },
  { languages: [{ name: "Inglés", level: "B2" }] },
  { linkedin: "https://example.com/in/persona", github: null, portfolio: null },
];

describe("nextCvTopic", () => {
  it("recorre el temario en orden fijo, sin intervención del modelo", () => {
    let s = initialCvChatState();
    const kinds: string[] = [];
    for (const raw of script) {
      kinds.push(nextCvTopic(s)!.kind);
      s = answer(s, raw);
    }
    expect(kinds).toEqual([
      "target",
      "organization",
      "title",
      "dates",
      "duties",
      "achievement",
      "more_work",
      "education",
      "certifications",
      "skills",
      "languages",
      "links",
    ]);
    expect(nextCvTopic(s)).toBeNull();
    expect(cvChatCloseReason(s)).toBe("complete");
    expect(s.turns).toBe(script.length);
    expect(s.skills).toEqual(["SQL", "Excel"]);
  });

  it("de a un trabajo: «otro» abre un segundo borrador", () => {
    let s = initialCvChatState({ target: "x" });
    for (const raw of script.slice(1, 6)) s = answer(s, raw);
    s = answer(s, { more: true });
    expect(nextCvTopic(s)).toMatchObject({ kind: "organization", workIndex: 1 });
    expect(s.works).toHaveLength(2);
  });

  it("sin experiencia sigue con estudios", () => {
    let s = initialCvChatState({ target: "x" });
    s = answer(s, { organization: null, noExperience: true });
    expect(nextCvTopic(s)?.kind).toBe("education");
  });

  it("no repregunta lo ya confirmado", () => {
    const s = initialCvChatState({
      target: "Analista",
      history: [
        {
          kind: "trabajo",
          organization: "Empresa A",
          title: "Analista",
          startMonth: null,
          endMonth: null,
          bullets: [],
        },
      ],
      skills: ["SQL"],
    });
    expect(nextCvTopic(s)?.kind).toBe("education");
  });
});

describe("falla cerrado", () => {
  it("una respuesta fuera de esquema no cambia los datos y a la segunda se saltea el tema", () => {
    let s = initialCvChatState();
    const t = nextCvTopic(s)!;
    s = applyCvAnswer(s, t, { target: "x", extra: 1 });
    expect(s.target).toBeNull();
    expect(nextCvTopic(s)?.kind).toBe("target");
    s = applyCvAnswer(s, t, "texto suelto");
    expect(s.target).toBeNull();
    expect(nextCvTopic(s)?.kind).toBe("organization");
    expect(s.turns).toBe(2);
  });

  it("la conversación siempre termina aunque el modelo falle en todo", () => {
    let s = initialCvChatState();
    for (let i = 0; i < 60 && nextCvTopic(s); i++) s = applyCvAnswer(s, nextCvTopic(s)!, null);
    expect(nextCvTopic(s)).toBeNull();
    expect(s.workDone).toBe(true);
  });

  it("saltear un tema lo deja respondido sin datos", () => {
    let s = initialCvChatState({ target: "x" });
    s = skipCvTopic(s, nextCvTopic(s)!);
    expect(s.workDone).toBe(true);
    expect(nextCvTopic(s)?.kind).toBe("education");
  });
});

describe("cvChatCloseReason", () => {
  it("«Terminar y armar» cierra con el checklist incompleto", () => {
    expect(cvChatCloseReason(initialCvChatState(), { finishRequested: true })).toBe("finish");
  });
  it("cierra al llegar a 25 turnos", () => {
    const s = { ...initialCvChatState(), turns: CV_CHAT_MAX_TURNS };
    expect(cvChatCloseReason(s)).toBe("turn_cap");
    expect(cvChatCloseReason({ ...s, turns: CV_CHAT_MAX_TURNS - 1 })).toBeNull();
  });
});

describe("historial y tarjeta", () => {
  let s = initialCvChatState();
  for (const raw of script) s = answer(s, raw);

  it("cvChatHistory devuelve filas de career_history con las viñetas de la persona", () => {
    const h = cvChatHistory(s);
    expect(h.map((x) => x.kind)).toEqual(["trabajo", "educacion"]);
    expect(h[0]).toMatchObject({ organization: "Empresa A", title: "Analista", endMonth: null });
    expect(h[0]!.bullets).toEqual(["Armé reportes en SQL", "Bajé el cierre de 5 a 3 días"]);
  });

  it("cvWorkSources junta lo que dijo la persona", () => {
    expect(cvWorkSources(s.works[0]!)).toEqual([
      "Empresa A",
      "Analista",
      "Armé reportes en SQL",
      "Bajé el cierre de 5 a 3 días",
    ]);
  });

  it("la tarjeta muestra lo entendido y marca lo que falta", () => {
    const card = buildCvUnderstoodCard(s);
    expect(card.title).toBe("Esto es lo que entendí");
    expect(card.sections.map((x) => x.id)).toEqual([
      "target",
      "experience",
      "education",
      "skills",
      "languages",
      "links",
    ]);
    expect(card.sections[1]!.items[0]).toMatchObject({
      heading: "Analista",
      detail: "Empresa A | 03/2021 – Actual",
    });
    expect(card.missing).toEqual([]);
    expect(buildCvUnderstoodCard(initialCvChatState()).missing).toContain("experience");
  });

  it("un trabajo sin cargo no entra al historial y se cuenta", () => {
    let p = initialCvChatState({ target: "x" });
    p = answer(p, { organization: "Empresa B", noExperience: false });
    expect(cvChatHistory(p)).toEqual([]);
    expect(buildCvUnderstoodCard(p).incompleteWorks).toBe(1);
  });

  it("el avance cuenta secciones", () => {
    expect(cvChecklistProgress(initialCvChatState())).toEqual({ done: 0, total: 7 });
    expect(cvChecklistProgress(s)).toEqual({ done: 7, total: 7 });
  });
});
