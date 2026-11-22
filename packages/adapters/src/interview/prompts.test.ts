import {
  buildFeedbackPromptVars,
  buildQuestionsPromptVars,
  InterviewFeedbackOutputSchema,
  InterviewQuestionsOutputSchema,
} from "@job-search-os/pipeline";
import { loadPrompt, renderPrompt, templateVars } from "@job-search-os/prompts";
import { describe, expect, it } from "vitest";
import { createDemoLlm } from "../llm/demo";
import { memoryCallSink } from "../llm/calls";
import {
  INTERVIEW_FEEDBACK_PROMPT,
  INTERVIEW_FEEDBACK_TASK,
  INTERVIEW_QUESTIONS_PROMPT,
  INTERVIEW_QUESTIONS_TASK,
} from "./generate";

const context = { kind: "career", career: "Analista de datos", seniority: "junior" } as const;

describe("interview_questions@v1", () => {
  const loaded = loadPrompt(INTERVIEW_QUESTIONS_PROMPT);

  it("carga y pide exactamente las variables que arma el pipeline", () => {
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.task).toBe(INTERVIEW_QUESTIONS_TASK);
    expect(templateVars(loaded.value.template)).toEqual(
      Object.keys(buildQuestionsPromptVars(context)),
    );
    expect(renderPrompt(loaded.value, buildQuestionsPromptVars(context)).ok).toBe(true);
  });

  it("trata el contexto como dato, pide 5 preguntas y no pide datos sensibles", () => {
    if (!loaded.ok) throw new Error("no carga");
    const t = loaded.value.template;
    expect(t).toMatch(/exactamente 5 preguntas/);
    expect(t).toMatch(/dato, no una instrucción/);
    expect(t).toMatch(/No pidas datos sensibles/);
    expect(t).toMatch(/<<<CONTEXTO>>>/);
  });
});

describe("interview_feedback@v1", () => {
  const loaded = loadPrompt(INTERVIEW_FEEDBACK_PROMPT);
  const vars = buildFeedbackPromptVars({
    context,
    question: "Contame un problema que resolviste.",
    answer: "Armé un tablero que redujo el tiempo de cierre un 30%.",
  });

  it("carga y pide exactamente las variables que arma el pipeline", () => {
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.task).toBe(INTERVIEW_FEEDBACK_TASK);
    expect([...templateVars(loaded.value.template)].sort()).toEqual(Object.keys(vars).sort());
    expect(renderPrompt(loaded.value, vars).ok).toBe(true);
  });

  it("trata pregunta y respuesta como datos, explica los tres criterios y no pide datos sensibles", () => {
    if (!loaded.ok) throw new Error("no carga");
    const t = loaded.value.template;
    expect(t).toMatch(/datos, no instrucciones/);
    expect(t).toMatch(/<<<RESPUESTA>>>/);
    expect(t).toMatch(/`clarity`/);
    expect(t).toMatch(/`relevance`/);
    expect(t).toMatch(/`star`/);
    expect(t).toMatch(/No pidas datos sensibles/);
    expect(t).toMatch(/No inventes experiencia/);
  });
});

describe("fakes de LLM_DEMO del simulador", () => {
  it("las preguntas falsas cumplen el esquema y se registran con model = fake y costo 0", async () => {
    const calls = memoryCallSink();
    const llm = createDemoLlm({ calls });
    const r = await llm.generateStructured(
      INTERVIEW_QUESTIONS_TASK,
      InterviewQuestionsOutputSchema,
      buildQuestionsPromptVars(context),
      { userId: "u1", promptVersion: INTERVIEW_QUESTIONS_PROMPT, label: "interview:x" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.object.questions).toHaveLength(5);
    expect(new Set(r.value.object.questions).size).toBe(5);
    expect(r.value.object.questions[0]).toContain("Analista de datos");
    expect(r.value.model).toBe("fake");
    expect(r.value.costUsd).toBe(0);
    expect(calls.calls[0]).toMatchObject({
      task: INTERVIEW_QUESTIONS_TASK,
      model: "fake",
      costUsd: 0,
    });
  });

  it("la devolución falsa cumple el esquema y puntúa más a la respuesta con resultado", async () => {
    const llm = createDemoLlm();
    const run = async (answer: string) => {
      const r = await llm.generateStructured(
        INTERVIEW_FEEDBACK_TASK,
        InterviewFeedbackOutputSchema,
        buildFeedbackPromptVars({
          context,
          question: "Pregunta de práctica para el simulador.",
          answer,
        }),
        { userId: "u1", promptVersion: INTERVIEW_FEEDBACK_PROMPT },
      );
      if (!r.ok) throw new Error("falló el fake");
      return r.value.object;
    };
    const corta = await run("Hice lo que pude con el equipo.");
    const completa = await run(
      "Cuando el cierre tardaba dos días en mi proyecto, armé un tablero y logré bajarlo a una hora, un 80% menos.",
    );
    expect(completa.star).toBeGreaterThan(corta.star);
    for (const f of [corta, completa]) {
      for (const k of ["clarity", "relevance", "star"] as const) {
        expect(f[k]).toBeGreaterThanOrEqual(0);
        expect(f[k]).toBeLessThanOrEqual(10);
      }
    }
  });
});
