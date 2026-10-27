import { describe, expect, it } from "vitest";
import type { CvHistoryInput } from "../cv-out/model";
import { cvTopicQuestion } from "./questions";
import { initialCvChatState, nextCvTopic } from "./state";
import { applyCvWrite, CV_WRITE_OUTPUT_SCHEMA, cvWriteVars, type CvWriteInput } from "./write";

const history: CvHistoryInput[] = [
  {
    kind: "trabajo",
    organization: "Empresa A",
    title: "Analista",
    startMonth: "2021-03",
    endMonth: null,
    bullets: ["Armé reportes en SQL para 12 sucursales", "Bajé el cierre de 5 a 3 días"],
  },
  {
    kind: "educacion",
    organization: "Universidad A",
    title: "Lic. en Estadística",
    startMonth: null,
    endMonth: null,
    bullets: [],
  },
];

const input: CvWriteInput = {
  lang: "es",
  target: "Analista de datos",
  history,
  skills: ["SQL", "Excel"],
  languages: ["Inglés: B2"],
};

describe("cvWriteVars", () => {
  it("manda solo los trabajos con sus respuestas, y el resto como contexto", () => {
    const v = cvWriteVars(input);
    expect(JSON.parse(v.works!)).toEqual([
      {
        id: "h0",
        organization: "Empresa A",
        title: "Analista",
        answers: history[0]!.bullets,
      },
    ]);
    expect(JSON.parse(v.context!).studies).toEqual([
      { organization: "Universidad A", title: "Lic. en Estadística" },
    ]);
    expect(v.lang).toBe("es");
  });
});

describe("applyCvWrite", () => {
  it("usa las viñetas del modelo si no inventan nada", () => {
    const out = CV_WRITE_OUTPUT_SCHEMA.parse({
      summary: "Analista de datos con experiencia en reportes en SQL.",
      entries: [
        {
          id: "h0",
          bullets: [
            "Desarrollé reportes en SQL para 12 sucursales.",
            "Reduje el cierre de 5 a 3 días.",
          ],
        },
      ],
    });
    const r = applyCvWrite(input, out);
    expect(r.history[0]!.bullets).toEqual([
      "Desarrollé reportes en SQL para 12 sucursales.",
      "Reduje el cierre de 5 a 3 días.",
    ]);
    expect(r.summary).toBe("Analista de datos con experiencia en reportes en SQL.");
    expect(r.stats).toMatchObject({ bullets: 2, fromModel: 2, fromPerson: 0, summary: "model" });
  });

  it("descarta lo inventado y deja el texto de la persona", () => {
    const out = CV_WRITE_OUTPUT_SCHEMA.parse({
      summary: "Líder con 10 años de experiencia en Empresa Z.",
      entries: [
        {
          id: "h0",
          bullets: [
            "Desarrollé reportes en SQL para 12 sucursales.",
            "Reduje el cierre un 60% con Power BI.",
          ],
        },
      ],
    });
    const r = applyCvWrite(input, out);
    expect(r.history[0]!.bullets).toEqual(
      ["Desarrollé reportes en SQL para 12 sucursales.", "Bajé el cierre de 5 a 3 días"].map(
        (b) => b.charAt(0).toUpperCase() + b.slice(1),
      ),
    );
    expect(r.stats.fromPerson).toBe(1);
    expect(r.stats.rejected.number_not_in_answers).toBe(1);
    expect(r.summary).toBeNull();
    expect(r.stats.summary).toBe("none");
  });

  it("ignora ids desconocidos y conserva el texto de la persona sin salida", () => {
    const out = CV_WRITE_OUTPUT_SCHEMA.parse({
      summary: "",
      entries: [{ id: "h9", bullets: ["Inventé algo"] }],
    });
    const r = applyCvWrite(input, out);
    expect(r.history).toEqual(history);
    expect(r.summary).toBeNull();
  });

  it("no toca estudios", () => {
    const out = CV_WRITE_OUTPUT_SCHEMA.parse({
      summary: "",
      entries: [{ id: "h1", bullets: ["x"] }],
    });
    expect(applyCvWrite(input, out).history[1]).toEqual(history[1]);
  });

  it("el esquema de salida es estricto", () => {
    expect(CV_WRITE_OUTPUT_SCHEMA.safeParse({ summary: "", entries: [], extra: 1 }).success).toBe(
      false,
    );
  });
});

describe("cvTopicQuestion", () => {
  it("cada tema del temario tiene su pregunta fija, con el contexto del trabajo", () => {
    let s = initialCvChatState({ target: "x" });
    expect(cvTopicQuestion(nextCvTopic(s)!, s)).toContain("empresa");
    s = {
      ...s,
      works: [
        {
          organization: "Empresa A",
          title: null,
          startMonth: null,
          endMonth: null,
          isCurrent: false,
          duties: [],
          achievement: null,
        },
      ],
      answered: ["target", "w0:organization"],
    };
    expect(cvTopicQuestion(nextCvTopic(s)!, s)).toBe("¿Qué cargo tenías en Empresa A?");
  });
});
