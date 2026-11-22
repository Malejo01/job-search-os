import { describe, expect, it } from "vitest";
import {
  INTERVIEW_QUESTION_COUNT,
  InterviewFeedbackOutputSchema,
  InterviewQuestionsOutputSchema,
  interviewFeedbackWire,
  interviewQuestionsWire,
} from "./schemas";

const questions = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => `¿Contanos una situación ${i + 1} en la que resolviste un problema?`,
  );

const feedback = {
  clarity: 7,
  relevance: 8,
  star: 4,
  tip: "Abrí con la situación en una frase y recién después contá lo que hiciste.",
  example:
    "En mi último trabajo tardábamos dos días en cerrar el reporte; armé una planilla y lo bajé a una hora.",
};

describe("InterviewQuestionsOutputSchema", () => {
  it("acepta exactamente cinco preguntas", () => {
    expect(INTERVIEW_QUESTION_COUNT).toBe(5);
    expect(InterviewQuestionsOutputSchema.safeParse({ questions: questions(5) }).success).toBe(
      true,
    );
  });

  it("rechaza menos o más de cinco", () => {
    expect(InterviewQuestionsOutputSchema.safeParse({ questions: questions(4) }).success).toBe(
      false,
    );
    expect(InterviewQuestionsOutputSchema.safeParse({ questions: questions(6) }).success).toBe(
      false,
    );
  });

  it("rechaza preguntas vacías o larguísimas", () => {
    const q = questions(5);
    expect(
      InterviewQuestionsOutputSchema.safeParse({ questions: [...q.slice(0, 4), "  "] }).success,
    ).toBe(false);
    expect(
      InterviewQuestionsOutputSchema.safeParse({ questions: [...q.slice(0, 4), "a".repeat(400)] })
        .success,
    ).toBe(false);
  });

  it("el wire recorta la lista a cinco y las preguntas largas; el esquema estricto las acepta", () => {
    const raw = {
      questions: [...questions(6).slice(0, 5), "x"].map((q, i) =>
        i === 0 ? q + "a".repeat(400) : q,
      ),
    };
    const normalized = interviewQuestionsWire.normalize(raw);
    const parsed = InterviewQuestionsOutputSchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.questions).toHaveLength(5);
  });
});

describe("InterviewFeedbackOutputSchema", () => {
  it("acepta puntajes enteros de 0 a 10", () => {
    expect(InterviewFeedbackOutputSchema.safeParse(feedback).success).toBe(true);
    expect(
      InterviewFeedbackOutputSchema.safeParse({ ...feedback, clarity: 0, star: 10 }).success,
    ).toBe(true);
  });

  it("rechaza puntajes fuera de rango, decimales o que no son número", () => {
    for (const bad of [-1, 11, 7.5, Number.NaN, "7"]) {
      expect(
        InterviewFeedbackOutputSchema.safeParse({ ...feedback, clarity: bad }).success,
        String(bad),
      ).toBe(false);
    }
  });

  it("exige consejo y ejemplo con texto", () => {
    expect(InterviewFeedbackOutputSchema.safeParse({ ...feedback, tip: " " }).success).toBe(false);
    expect(InterviewFeedbackOutputSchema.safeParse({ ...feedback, example: "" }).success).toBe(
      false,
    );
  });

  it("el wire redondea decimales pero un puntaje fuera de rango sigue fallando", () => {
    const rounded = InterviewFeedbackOutputSchema.safeParse(
      interviewFeedbackWire.normalize({ ...feedback, clarity: 6.6 }),
    );
    expect(rounded.success && rounded.data.clarity).toBe(7);
    const out = InterviewFeedbackOutputSchema.safeParse(
      interviewFeedbackWire.normalize({ ...feedback, star: 14 }),
    );
    expect(out.success).toBe(false);
  });

  it("el wire recorta consejo y ejemplo largos", () => {
    const parsed = InterviewFeedbackOutputSchema.safeParse(
      interviewFeedbackWire.normalize({
        ...feedback,
        tip: "palabra ".repeat(200),
        example: "dato ".repeat(400),
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it("el esquema de viaje no lleva límites de largo ni de rango", () => {
    const json = JSON.stringify(
      interviewFeedbackWire.schema.safeParse({ ...feedback, clarity: 99 }),
    );
    expect(JSON.parse(json).success).toBe(true);
  });
});
