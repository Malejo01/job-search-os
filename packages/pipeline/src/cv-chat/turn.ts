/**
 * Lo que pasa con la salida del modelo en un turno del chat de CV, sin I/O (R12-2). El adaptador hace la
 * llamada a `cv_interview` y le pasa a `applyCvModelTurn` el objeto ya validado por el esquema del turno;
 * la línea de base (`baseline.ts`) recorre transcripciones grabadas con esta misma función, así lo que se
 * mide es exactamente lo que corre en producción.
 */
import { z } from "zod";
import { hasSensitiveCvData, resolveCvFollowUp } from "./follow-up";
import { cvUnderstoodAck } from "./ack";
import { findCvConflict } from "./conflicts";
import { extractionGrounded, safeCvAck } from "./grounding";
import { applyCvExtras, CV_EXTRAS_FIELD, usableCvExtras, type CvExtra } from "./extras";
import { CV_EXTRACTION_SCHEMAS } from "./schemas";
import { applyCvAnswer, type CvChatState, type CvTopic } from "./state";

/** Esquema de la respuesta del modelo para un tema: la extracción del tema, el acuse y la repregunta. */
export function cvInterviewTurnSchema(topic: CvTopic) {
  return z.strictObject({
    extraction: CV_EXTRACTION_SCHEMAS[topic.kind],
    /** Otros datos del mismo trabajo y proyectos dichos en el mensaje (R12-2); opcional. */
    extras: CV_EXTRAS_FIELD,
    ack: z.string().max(300).nullable(),
    /** Borrador de repregunta: el código decide si se usa (`resolveCvFollowUp`). */
    followUp: z.string().max(400).nullable().optional(),
  });
}

/** Lo mínimo que se lee de la respuesta del modelo (ya validada por `cvInterviewTurnSchema`). */
export interface CvModelTurn {
  extraction: unknown;
  /** Sin el campo (respuesta del esquema de un tema) es como `[]`. */
  extras?: readonly (CvExtra | null)[];
  ack: string | null;
  followUp?: string | null;
}

export interface CvAppliedTurn {
  state: CvChatState;
  /** Acuse para mostrar, ya filtrado; `null` si el modelo no mandó ninguno. */
  ack: string | null;
}

/**
 * Aplica la respuesta del modelo al estado. Lo extraído tiene que estar en lo que escribió la persona
 * (números, nombres, tecnologías, links); si no, se descarta y el tema cuenta como falla. Después vuelve a
 * pasar por el esquema estricto. Nunca se copian datos sensibles aunque el modelo los extraiga. La
 * repregunta la decide el código (tope, «no tengo», qué falta); el modelo solo aporta el texto.
 */
export function applyCvModelTurn(
  state: CvChatState,
  topic: CvTopic,
  message: string,
  turn: CvModelTurn,
): CvAppliedTurn {
  const usable =
    extractionGrounded(turn.extraction, message) &&
    !hasSensitiveCvData(JSON.stringify(turn.extraction));
  const answered = applyCvAnswer(state, topic, usable ? turn.extraction : null);
  // Extras (R12-2): cada uno con su propio control; uno descartado no tira la extracción del tema
  const extras = usableCvExtras(turn.extras ?? [], message);
  // Contradicción (R12-3): lo que choca con lo anterior no se aplica hasta que la persona elige
  const conflict = state.conflict ?? findCvConflict(answered, topic, extras);
  const withExtras = applyCvExtras(answered, topic, extras);
  const followed = resolveCvFollowUp(withExtras, topic, message, turn.followUp);
  const next = { ...followed, conflict };
  // Acuse (R12-3): lo arma el código con lo entendido y ya verificado; si no hay nada nuevo, el del
  // modelo filtrado (con dígitos cae al fijo)
  const ack = cvUnderstoodAck(state, next) ?? (turn.ack ? safeCvAck(turn.ack) : null);
  return { state: next, ack };
}
