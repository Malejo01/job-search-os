import { describe, expect, it } from "vitest";
import { cvMonthLabel, cvUnderstoodAck } from "./ack";
import { CV_FIXED_ACK } from "./grounding";
import { initialCvChatState, nextCvTopic, type CvChatState } from "./state";
import { applyCvModelTurn, cvInterviewTurnSchema } from "./turn";

const MSG =
  "Trabajé en Empresa A como Desarrollador de aplicaciones web, de abril 2025 a febrero 2026. Hacía el front con React.";

function turn(state: CvChatState, message: string, object: Record<string, unknown>) {
  const topic = nextCvTopic(state)!;
  return applyCvModelTurn(state, topic, message, cvInterviewTurnSchema(topic).parse(object));
}

describe("acuse armado por el código con lo entendido (R12-3)", () => {
  it("empresa, cargo y meses en un mensaje: «Anoté Empresa A, el cargo y abril de 2025 a febrero de 2026»", () => {
    const out = turn(initialCvChatState({ target: "AI Engineer" }), MSG, {
      extraction: { organization: "Empresa A", noExperience: false },
      extras: [
        { kind: "title", title: "Desarrollador de aplicaciones web" },
        { kind: "dates", startMonth: "2025-04", endMonth: "2026-02", isCurrent: false },
        { kind: "duties", duties: ["Hacía el front con React"] },
      ],
      ack: "Bárbaro, ya anoté la empresa.",
    });
    expect(out.ack).toBe(
      "Anoté Empresa A, Desarrollador de aplicaciones web, abril de 2025 a febrero de 2026 y lo que hacías.",
    );
  });

  it("nunca usa el texto del modelo con dígitos: lo armado por el código sí puede llevar años", () => {
    const s = turn(initialCvChatState({ target: "AI Engineer" }), "Trabajé en Empresa A", {
      extraction: { organization: "Empresa A", noExperience: false },
      ack: "Genial, 10 años en Empresa A",
    });
    expect(s.ack).toBe("Anoté Empresa A.");
    // sin nada nuevo (el tema falló), el acuse del modelo con dígitos cae al fijo
    const failed = turn(initialCvChatState({ target: "AI Engineer" }), "Trabajé en Empresa A", {
      extraction: { organization: "Empresa Z", noExperience: false },
      ack: "Genial, 10 años",
    });
    expect(failed.ack).toBe(CV_FIXED_ACK);
  });

  it("sin nada nuevo y sin acuse del modelo, no hay acuse", () => {
    const s = initialCvChatState({ target: "AI Engineer" });
    expect(cvUnderstoodAck(s, s)).toBeNull();
  });

  it("fechas: en curso, solo inicio y solo fin", () => {
    const s = initialCvChatState({ target: "x" });
    const w = (patch: Partial<CvChatState["works"][number]>): CvChatState => ({
      ...s,
      works: [
        {
          organization: null,
          title: null,
          startMonth: null,
          endMonth: null,
          isCurrent: false,
          duties: [],
          achievement: null,
          ...patch,
        },
      ],
    });
    expect(cvUnderstoodAck(s, w({ startMonth: "2021-03", isCurrent: true }))).toBe(
      "Anoté desde marzo de 2021 hasta hoy.",
    );
    expect(cvUnderstoodAck(s, w({ startMonth: "2021-03" }))).toBe("Anoté desde marzo de 2021.");
    expect(cvUnderstoodAck(s, w({ achievement: "Bajé costos" }))).toBe("Anoté tu logro.");
  });

  it("puesto, proyectos y secciones de lista", () => {
    const s = initialCvChatState();
    expect(cvUnderstoodAck(s, { ...s, target: "AI Engineer / Full Stack" })).toBe(
      "Anoté que apuntás a AI Engineer / Full Stack.",
    );
    const projects = ["Proyecto 1", "Proyecto 2", "Proyecto 3"].map((name) => ({
      name,
      role: null,
      description: null,
      stack: [],
      link: null,
    }));
    expect(cvUnderstoodAck(s, { ...s, projects })).toBe(
      "Anoté los proyectos Proyecto 1, Proyecto 2 y Proyecto 3.",
    );
    expect(cvUnderstoodAck(s, { ...s, projects: projects.slice(0, 1) })).toBe(
      "Anoté el proyecto Proyecto 1.",
    );
    expect(
      cvUnderstoodAck(s, {
        ...s,
        education: [
          { institution: "Universidad A", title: "Tecnicatura", startMonth: null, endMonth: null },
        ],
        skills: ["TypeScript", "React", "Node", "Python", "SQL"],
        languages: [{ name: "Inglés", level: "avanzado" }],
      }),
    ).toBe("Anoté Tecnicatura en Universidad A, TypeScript, React, Node y 2 skills más e Inglés.");
  });

  it("meses en español", () => {
    expect(cvMonthLabel("2026-02")).toBe("febrero de 2026");
    expect(cvMonthLabel("2025-12")).toBe("diciembre de 2025");
  });
});
