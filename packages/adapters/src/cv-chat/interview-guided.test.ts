import {
  cvChatHistory,
  cvSummaryCheck,
  cvSummaryDraft,
  cvSoftProposals,
  initialCvChatState,
  nextCvTopic,
  type CvChatState,
} from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { createDemoLlm } from "../llm";
import type { LlmClient } from "../llm";
import { runCvInterviewTurn } from "./interview";

/**
 * Flujo guiado de la R33 con el modelo simulado: el resumen profesional y las situaciones de habilidades blandas
 * las resuelve el código con las palabras de la persona, sin llamar al modelo (USD 0). Datos inventados.
 */
const base = { userId: "u1", conversationId: "abc123" };

const script: Record<string, string> = {
  summary_experience: "Tres años en administración y cobranzas",
  summary_goal: "Quiero sumarme a un equipo chico de finanzas",
  summary_strengths: "Ordeno información y detecto errores",
  organization: "Empresa A",
  title: "Analista",
  dates: "03/2021 - actual",
  duties: "Armé reportes semanales; automaticé la revisión",
  achievement: "no",
  more_work: "no",
  education: "Universidad A, Lic. en Administración, 2013 - 2018",
  certifications: "no",
  skills: "Excel",
  soft_lead: "Coordiné a cuatro personas en el local",
  soft_problem: "no",
  soft_clients: "Atendí reclamos de clientes y de otras áreas",
  soft_organize: "Ordené el archivo de facturas",
  languages: "Inglés B2",
  links: "no",
};

/** Un LLM que falla si se lo llama: los temas nuevos no pueden usarlo. */
const noLlm = (): { llm: LlmClient; calls: () => number } => {
  let n = 0;
  const inner = createDemoLlm();
  return {
    llm: {
      async generateStructured(task, schema, vars, ctx) {
        n++;
        return inner.generateStructured(task, schema, vars, ctx);
      },
    },
    calls: () => n,
  };
};

async function run(): Promise<{ state: CvChatState; kinds: string[]; llmCalls: number }> {
  const { llm, calls } = noLlm();
  let state = initialCvChatState({ guided: true });
  const kinds: string[] = [];
  const first = nextCvTopic(state)!;
  expect(first.kind).toBe("target");
  for (let guard = 0; guard < 40; guard++) {
    const topic = nextCvTopic(state);
    if (!topic) break;
    kinds.push(topic.kind);
    const message = topic.kind === "target" ? "Analista contable" : script[topic.kind]!;
    const out = await runCvInterviewTurn({ llm }, { ...base, state, topic, message });
    if (out.kind !== "turn") throw new Error(`turno inesperado: ${out.kind}`);
    state = out.state;
  }
  return { state, kinds, llmCalls: calls() };
}

describe("flujo guiado con el modelo simulado", () => {
  it("recorre el temario completo y solo los temas de siempre llaman al modelo", async () => {
    const { state, kinds, llmCalls } = await run();
    expect(nextCvTopic(state)).toBeNull();
    const local = kinds.filter((k) => k.startsWith("summary_") || k.startsWith("soft_"));
    expect(local).toEqual([
      "summary_experience",
      "summary_goal",
      "summary_strengths",
      "soft_lead",
      "soft_problem",
      "soft_clients",
      "soft_organize",
    ]);
    expect(llmCalls).toBe(kinds.length - local.length);
  });

  it("guarda las palabras de la persona y nada más", async () => {
    const { state } = await run();
    expect(state.summary).toMatchObject({
      experience: "Tres años en administración y cobranzas",
      goal: "Quiero sumarme a un equipo chico de finanzas",
      strengths: "Ordeno información y detecto errores",
      text: null,
    });
    // «no» a una situación no guarda nada
    expect(Object.keys(state.softAnswers).sort()).toEqual(["clients", "lead", "organize"]);
    expect(state.softSkills).toEqual([]); // nada se usa hasta que la persona lo marca
    expect(cvChatHistory(state).map((h) => h.kind)).toEqual(["trabajo", "educacion"]);
  });

  it("el borrador del resumen sale de las respuestas y pasa el validador", async () => {
    const { state } = await run();
    const draft = cvSummaryDraft(state)!;
    expect(draft).toContain("Tres años en administración y cobranzas.");
    expect(draft).toContain("Busco un puesto de Analista contable.");
    expect(cvSummaryCheck(draft, state)).toEqual({ ok: true });
  });

  it("propone habilidades blandas solo de lo que contó, con su origen, y no las agrega solas", async () => {
    const { state } = await run();
    const p = cvSoftProposals(state);
    expect(p.map((x) => x.skill)).toEqual([
      "Liderazgo",
      "Comunicación",
      "Atención al cliente",
      "Trabajo en equipo",
    ]);
    expect(p.every((x) => x.from === "Empresa A")).toBe(true);
  });

  it("un dato personal sensible o un link en la respuesta no entra al resumen", async () => {
    const { llm } = noLlm();
    const s0 = initialCvChatState({ guided: true, target: "Puesto A" });
    const topic = nextCvTopic(s0)!;
    expect(topic.kind).toBe("summary_experience");
    const out = await runCvInterviewTurn(
      { llm },
      { ...base, state: s0, topic, message: "Soy casada y tengo dos hijos" },
    );
    if (out.kind !== "turn") throw new Error("turno inesperado");
    expect(out.state.summary.experience).toBeNull();
    // el tema cuenta como respondido y se sigue
    expect(out.next?.kind).toBe("summary_goal");
  });
});
