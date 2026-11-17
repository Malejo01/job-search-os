/**
 * Línea de base del chat de CV (R12-2, plan-coach-cv §5.2). Recorre una transcripción con las respuestas del
 * modelo ya grabadas, con el mismo código que corre en producción (`applyCvModelTurn`), y mide dos cosas:
 * - **Datos perdidos:** hechos que la persona dijo y que no terminan en el historial ni en el estado final,
 *   sobre el total de hechos dichos.
 * - **Preguntas repetidas:** preguntas sobre un tema del que la persona ya había dado el dato en un turno
 *   anterior, sobre el total de preguntas.
 * Sin modelo, sin I/O y sin fecha: puro y repetible.
 *
 * La persona es código: cuando el chat pregunta un tema, contesta con el próximo mensaje de la transcripción
 * que todavía no dijo. Los mensajes marcados `repite` solo repiten algo ya dicho porque se lo preguntaron
 * (el 17/11, las fechas y las tareas): esos solo se mandan si el chat pregunta justo ese tema. Si no queda
 * ningún mensaje para mandar, la persona toca «Saltear».
 */
import { z } from "zod";
import { foldCvText } from "../cv-out/verify";
import { err, ok, type Result } from "../result";
import { classifyCvChatInput } from "./input";
import { CV_CHAT_TOPIC_KINDS, type CvTopicKind } from "./schemas";
import {
  CV_CHAT_MAX_TURNS,
  cvChatHistory,
  initialCvChatState,
  nextCvTopic,
  skipCvTopic,
  type CvChatState,
} from "./state";
import { applyCvModelTurn, cvInterviewTurnSchema } from "./turn";

/** Dónde se busca un hecho al final de la charla. */
export const CV_BASELINE_FIELDS = [
  "target",
  "organization",
  "title",
  "startMonth",
  "endMonth",
  "bullet",
  "project",
  "education",
  "skill",
  "language",
] as const;
export type CvBaselineField = (typeof CV_BASELINE_FIELDS)[number];

/** Tema al que pertenece un hecho: los del chat, más `project` (ningún tema del chat lo pregunta). */
const FACT_TOPICS = [...CV_CHAT_TOPIC_KINDS, "project"] as const;

const turnObject = z.record(z.string(), z.unknown());

export const cvBaselineFixtureSchema = z.strictObject({
  descripcion: z.string(),
  /** Lo que ya estaba en la cuenta al empezar (el 17/11, nada: se preguntó el puesto). */
  semilla: z.strictObject({ target: z.string().nullable() }),
  mensajes: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        /** Tema que se le preguntó cuando lo dijo el 17/11. */
        tema: z.enum(CV_CHAT_TOPIC_KINDS),
        repite: z.boolean(),
        texto: z.string().min(1),
        /** Respuesta grabada del modelo por versión del esquema y por tema preguntado. */
        respuestas: z.record(z.string(), z.record(z.string(), turnObject)),
      }),
    )
    .min(1),
  hechos: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        /** Mensaje en el que lo dijo por primera vez. */
        mensaje: z.string().min(1),
        tema: z.enum(FACT_TOPICS),
        campo: z.enum(CV_BASELINE_FIELDS),
        /** Cualquiera de estos valores cuenta (p. ej., dos formas del mismo cargo). */
        valores: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
});
export type CvBaselineFixture = z.infer<typeof cvBaselineFixtureSchema>;

export interface CvBaselineTurn {
  topic: CvTopicKind;
  /** Mensaje que mandó la persona, o `null` si salteó. */
  messageId: string | null;
  /** La pregunta era sobre algo que ya había dicho. */
  repeated: boolean;
}

export interface CvBaselineResult {
  questions: number;
  repeated: number;
  /** Hechos de los mensajes que se llegaron a mandar. */
  factsSaid: number;
  lost: string[];
  lostRatio: number;
  repeatedRatio: number;
  turns: CvBaselineTurn[];
  state: CvChatState;
}

export type CvBaselineError =
  | { kind: "missing_response"; messageId: string; version: string; topic: CvTopicKind }
  | { kind: "schema"; messageId: string; topic: CvTopicKind }
  | { kind: "input"; messageId: string }
  | { kind: "no_progress" };

const same = (a: string, b: string): boolean => foldCvText(a).trim() === foldCvText(b).trim();
const contains = (hay: string, needle: string): boolean =>
  foldCvText(hay).includes(foldCvText(needle).trim());

/** ¿El hecho está en lo que sale de la charla (historial, puesto, skills, idiomas)? */
export function cvBaselineFactKept(
  state: CvChatState,
  fact: { campo: CvBaselineField; valores: readonly string[] },
): boolean {
  const history = cvChatHistory({ ...state, confirmed: [] });
  // `kind` como texto: el tipo «proyecto» lo suma R12-4 y acá se lo busca igual
  const ofKind = (k: string) => history.filter((h) => (h.kind as string) === k);
  const works = ofKind("trabajo");
  return fact.valores.some((v) => {
    switch (fact.campo) {
      case "target":
        return state.target !== null && contains(state.target, v);
      case "organization":
        return works.some((w) => same(w.organization, v));
      case "title":
        return works.some((w) => same(w.title, v));
      case "startMonth":
        return works.some((w) => w.startMonth === v);
      case "endMonth":
        return works.some((w) => w.endMonth === v);
      case "bullet":
        return works.some((w) => w.bullets.some((b) => contains(b, v)));
      case "project":
        return ofKind("proyecto").some((p) => contains(`${p.title} ${p.organization}`, v));
      case "education":
        return ofKind("educacion").some((e) => contains(`${e.title} ${e.organization}`, v));
      case "skill":
        return state.skills.some((s) => same(s, v));
      case "language":
        return state.languages.some((l) => same(l.name, v));
    }
  });
}

/** Recorre la transcripción con las respuestas grabadas de `version` y mide. */
export function runCvChatBaseline(
  fixture: CvBaselineFixture,
  version: string,
): Result<CvBaselineResult, CvBaselineError> {
  let state = initialCvChatState({ target: fixture.semilla.target });
  const used = new Set<string>();
  const sentAt = new Map<string, number>();
  const turns: CvBaselineTurn[] = [];

  for (let guard = 0; guard <= CV_CHAT_MAX_TURNS * 2; guard++) {
    const topic = nextCvTopic(state);
    if (!topic || state.turns >= CV_CHAT_MAX_TURNS) break;
    const k = turns.length;
    const repeated = fixture.hechos.some(
      (h) => h.tema === topic.kind && (sentAt.get(h.mensaje) ?? Infinity) < k,
    );
    const msg = fixture.mensajes.find(
      (m) => !used.has(m.id) && (!m.repite || m.tema === topic.kind),
    );
    if (!msg) {
      state = skipCvTopic(state, topic);
      turns.push({ topic: topic.kind, messageId: null, repeated });
      continue;
    }
    if (classifyCvChatInput(msg.texto).kind !== "ok")
      return err({ kind: "input", messageId: msg.id });
    const raw = fixture.mensajes.find((m) => m.id === msg.id)?.respuestas[version]?.[topic.kind];
    if (!raw) {
      return err({ kind: "missing_response", messageId: msg.id, version, topic: topic.kind });
    }
    const parsed = cvInterviewTurnSchema(topic).safeParse(raw);
    if (!parsed.success) return err({ kind: "schema", messageId: msg.id, topic: topic.kind });
    used.add(msg.id);
    sentAt.set(msg.id, k);
    state = applyCvModelTurn(state, topic, msg.texto, parsed.data).state;
    turns.push({ topic: topic.kind, messageId: msg.id, repeated });
  }
  if (nextCvTopic(state) !== null && state.turns < CV_CHAT_MAX_TURNS) {
    return err({ kind: "no_progress" });
  }

  const said = fixture.hechos.filter((h) => sentAt.has(h.mensaje));
  const lost = said.filter((h) => !cvBaselineFactKept(state, h)).map((h) => h.id);
  const repeatedCount = turns.filter((t) => t.repeated).length;
  return ok({
    questions: turns.length,
    repeated: repeatedCount,
    factsSaid: said.length,
    lost,
    lostRatio: said.length === 0 ? 0 : lost.length / said.length,
    repeatedRatio: turns.length === 0 ? 0 : repeatedCount / turns.length,
    turns,
    state,
  });
}
