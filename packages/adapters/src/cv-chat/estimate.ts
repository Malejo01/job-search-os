import { loadPrompt, renderPrompt } from "@job-search-os/prompts";
import {
  buildCvDocument,
  buildCvDocx,
  cvChatHistory,
  docxXmlToText,
  initialCvChatState,
  nextCvTopic,
  sniffCvFile,
  type CvChatState,
  type CvWriteStats,
} from "@job-search-os/pipeline";
import { createDemoLlm } from "../llm";
import type { LlmClient } from "../llm";
import type { Persona } from "./personas.fixtures";
import { runCvInterviewTurn } from "./interview";
import { runCvWrite } from "./write";

/**
 * Estimado sin red del costo del CV conversacional (C-25, CVC-6). Recorre una entrevista completa con el
 * fake de demo y mide el tamaño real de los prompts renderizados y de las salidas. Aproximación de tokens:
 * 1 token cada 4 caracteres (`CHARS_PER_TOKEN`); no es un tokenizador real.
 */
export const CHARS_PER_TOKEN = 4;
export const tokensOf = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN);

export type StepSize = { task: string; inChars: number; outChars: number };

/** Envuelve un cliente y anota, por llamada, el largo del prompt renderizado y de la salida. */
export function measuringLlm(inner: LlmClient, steps: StepSize[]): LlmClient {
  return {
    async generateStructured(task, schema, vars, ctx) {
      const prompt = loadPrompt(`${task}@v1`);
      const rendered = prompt.ok ? renderPrompt(prompt.value, vars) : null;
      const r = await inner.generateStructured(task, schema, vars, ctx);
      if (rendered?.ok && r.ok) {
        steps.push({
          task,
          inChars: rendered.value.length,
          outChars: JSON.stringify(r.value.object).length,
        });
      }
      return r;
    },
  };
}

export type PersonaRun = {
  id: string;
  /** Mensajes de la persona hasta cerrar el checklist. */
  turns: number;
  complete: boolean;
  steps: StepSize[];
  bullets: number;
  bulletsFromPerson: number;
  stats: CvWriteStats;
  docx: { isDocx: boolean; text: string; sections: string[] };
};

const STANDARD_SECTIONS = ["Resumen", "Experiencia", "Educación", "Skills", "Idiomas"];

/** Lee una entrada de un ZIP sin comprimir por el directorio central. */
export function readStoredEntry(zip: Uint8Array, name: string): string | null {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  const total = v.getUint16(eocd + 10, true);
  let pos = v.getUint32(eocd + 16, true);
  for (let i = 0; i < total; i++) {
    const nameLen = v.getUint16(pos + 28, true);
    const entry = new TextDecoder().decode(zip.subarray(pos + 46, pos + 46 + nameLen));
    if (entry === name) {
      const offset = v.getUint32(pos + 42, true);
      const size = v.getUint32(pos + 24, true);
      const start = offset + 30 + v.getUint16(offset + 26, true) + v.getUint16(offset + 28, true);
      return new TextDecoder().decode(zip.subarray(start, start + size));
    }
    pos += 46 + nameLen + v.getUint16(pos + 30, true) + v.getUint16(pos + 32, true);
  }
  return null;
}

export async function runPersona(persona: Persona): Promise<PersonaRun> {
  const steps: StepSize[] = [];
  const llm = measuringLlm(createDemoLlm(), steps);
  const queue = new Map(Object.entries(persona.answers).map(([k, v]) => [k, [...(v ?? [])]]));
  let state: CvChatState = initialCvChatState();
  let turns = 0;
  for (let guard = 0; guard < 60; guard++) {
    const topic = nextCvTopic(state);
    if (!topic) break;
    const message = queue.get(topic.kind)?.shift() ?? "no";
    const out = await runCvInterviewTurn(
      { llm },
      { userId: "u", conversationId: "0123456789ab", state, topic, message },
    );
    if (out.kind !== "turn") throw new Error(`${persona.id}: turno inesperado (${out.kind})`);
    state = out.state;
    turns++;
  }

  const history = cvChatHistory({ ...state, confirmed: [] });
  const written = await runCvWrite(
    { llm },
    {
      userId: "u",
      conversationId: "0123456789ab",
      input: {
        lang: "es",
        target: state.target,
        history,
        skills: state.skills,
        languages: state.languages.map((l) => (l.level ? `${l.name}: ${l.level}` : l.name)),
      },
    },
  );
  if (!written.ok) throw new Error(`${persona.id}: cv_write falló`);

  const doc = buildCvDocument(
    {
      displayName: "Persona Ficticia",
      email: "persona@example.com",
      summary: written.value.summary,
      skills: state.skills.map((name) => ({ name })),
      languages: state.languages.map((l) => ({ name: l.name, level: l.level })),
      achievements: [],
      history: written.value.history,
    },
    { lang: "es" },
  );
  const bytes = buildCvDocx(doc);
  const sniff = sniffCvFile(bytes);
  const xml = readStoredEntry(bytes, "word/document.xml");
  const text = xml ? docxXmlToText(xml) : null;
  const plain = text?.ok ? text.value : "";
  const lines = plain.split("\n");
  return {
    id: persona.id,
    turns,
    complete: nextCvTopic(state) === null,
    steps,
    bullets: written.value.stats.bullets,
    bulletsFromPerson: written.value.stats.fromPerson,
    stats: written.value.stats,
    docx: {
      isDocx: sniff.ok && sniff.value === "docx",
      text: plain,
      sections: STANDARD_SECTIONS.filter((s) => lines.includes(s)),
    },
  };
}

export type Price = { inUsd: number; outUsd: number };

/** USD de un paso con tarifas por millón de tokens. */
export const stepUsd = (inTokens: number, outTokens: number, p: Price): number =>
  (inTokens * p.inUsd + outTokens * p.outUsd) / 1_000_000;

/** Costo del CV de una corrida con un par de tarifas (entrevista, redacción). */
export function cvCostUsd(run: PersonaRun, interview: Price, write: Price): number {
  return run.steps.reduce(
    (t, s) =>
      t +
      stepUsd(tokensOf(s.inChars), tokensOf(s.outChars), s.task === "cv_write" ? write : interview),
    0,
  );
}
