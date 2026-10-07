import { schema as s, type Db } from "@job-search-os/db";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { spendCapReason } from "../llm/spend";
import type { LlmClient, LlmError } from "../llm/types";
import {
  ApplicantFailure,
  getCandidateProfile,
  listAnswers,
  NO_FACTS,
  NOT_LOADED,
  type BankAnswer,
  type CandidateProfile,
} from "./context";

/**
 * Borradores de respuestas para un formulario de postulación (JS-053, fase 2). Solo redacta lo que
 * es texto libre: las respuestas fijas (disponibilidad, contratación, autorización, links) y la
 * pretensión salarial se completan acá, deterministamente, y no pasan por el modelo. Lo que sí
 * pasa por el modelo se valida después: una fuente que no es una clave de candidate_facts se
 * trata como "sin fuente" y el borrador se vacía. Nada se envía: la persona copia y revisa.
 * Pensado para correr dentro de una transacción con app.user_id fijado (RLS).
 */

export const SIN_FUENTE = "sin fuente";

export const DraftApplicationAnswersSchema = z.object({
  drafts: z.array(
    z.object({
      question_id: z.string(),
      draft: z.string(),
      /** Claves de candidate_facts que respaldan lo que afirma el borrador. */
      sources: z.array(z.string()),
      confidence: z.enum(["alta", "media", "baja"]),
      note: z.string().optional(),
    }),
  ),
});
export type DraftApplicationAnswersOutput = z.infer<typeof DraftApplicationAnswersSchema>;

export type FormQuestion = { id: string; text: string };

export type DraftOrigin = "fija" | "salario" | "modelo";

export type DraftedAnswer = {
  question_id: string;
  question: string;
  /** fija/salario: las completó el código; modelo: las redactó el LLM y pasaron la validación. */
  origin: DraftOrigin;
  /** Vacío = la persona tiene que responder; `note` dice por qué. */
  draft: string;
  /** Claves de candidate_facts (solo origin "modelo"). */
  sources: string[];
  confidence: "alta" | "media" | "baja";
  note?: string;
  /** Fuentes que el modelo citó y no existen en candidate_facts (auditoría; nunca se muestran como respaldo). */
  invalid_sources?: string[];
};

export type DraftApplicationAnswersResult = {
  /** En el orden de las preguntas. */
  drafts: DraftedAnswer[];
  /** null si ninguna pregunta necesitó al modelo, o si falló (ver llm_error). */
  llm: {
    model: string;
    promptVersion: string;
    costUsd: number | null;
    usedFallback: boolean;
  } | null;
  /** Si el modelo falló, las respuestas fijas igual salen; el resto queda vacío con la nota. */
  llm_error: LlmError | null;
  /** Mensaje para la UI si un tope de gasto (global o del usuario) impidió llamar al modelo. */
  cap_message?: string;
};

/**
 * Guardia de tope de gasto para `draftApplicationAnswers` (JS-093): mismo chequeo que el worker
 * (`spendCapReason`). `db` es la conexión de servicio, que ve `llm_calls` de todos: la transacción
 * con RLS del usuario solo vería las suyas.
 */
export function draftsCapGuard(db: Db, userId: string): () => Promise<string | null> {
  return async () => {
    const reason = await spendCapReason(db, { userId });
    if (reason === "global")
      return "Se alcanzó el tope diario de gasto del modelo. Probá más tarde.";
    if (reason === "user") return "Alcanzaste tu tope diario de uso del modelo. Probá más tarde.";
    return null;
  };
}

export type FixedKind = "salary" | "work_authorization" | "availability" | "links" | "contract";

const fold = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

// Orden = prioridad: "salary expectations for a contract role" es de sueldo.
const FIXED_RULES: [FixedKind, RegExp][] = [
  [
    "salary",
    // "rate" solo como tarifa: "How would you rate your React?" no es de sueldo.
    /\b(salary|salaries|salario|salarial|sueldo|remuneracion|compensation|pretension|expectativa economica|pay expectation|desired pay|(hourly|daily|day|desired|expected) rate|rate expectations?|tarifa)\b/,
  ],
  [
    "work_authorization",
    /\b(work authori[sz]ation|authori[sz]ed to work|right to work|legally|visa|sponsorship|autorizacion (de|para) trabajo|autorizacion para trabajar|permiso de trabajo|derecho a trabajar)\b/,
  ],
  [
    "availability",
    /\b(availability|available to start|start date|notice period|when can you start|disponibilidad|fecha de inicio|preaviso|cuando (podes|puedes|podrias) (empezar|comenzar|incorporarte))\b/,
  ],
  ["links", /\b(linkedin|github|portfolio|personal (website|site)|sitio web|enlace|url)\b/],
  [
    "contract",
    // "contract" suelto no: "tu último contract role" es texto libre, no la modalidad.
    /\b(contract type|type of contract|contract or (full[- ]time|permanent|employee)|contractor|freelance|employment type|b2b|invoice|payroll|contratacion|modalidad de contrato|tipo de contrato)\b/,
  ],
];

/** null = texto libre, va al modelo. Conservador: ante la duda con las palabras de la lista, es fija. */
export function classifyFixed(text: string): FixedKind | null {
  const t = fold(text);
  return FIXED_RULES.find(([, re]) => re.test(t))?.[0] ?? null;
}

const SPANISH_HINT =
  /\b(que|cual|cuales|cuanto|cuando|tu|tus|sus|podes|puedes|tenes|tienes|estas|pretension|salarial|sueldo|salario|disponibilidad|experiencia|trabajo|años|anos)\b|[¿¡]/;
const isSpanish = (text: string): boolean => SPANISH_HINT.test(fold(text));

function emptyFixed(q: FormQuestion, origin: "fija" | "salario", note: string): DraftedAnswer {
  return {
    question_id: q.id,
    question: q.text,
    origin,
    draft: "",
    sources: [],
    confidence: "alta",
    note,
  };
}

function fixedDraft(q: FormQuestion, kind: FixedKind, profile: CandidateProfile): DraftedAnswer {
  if (kind === "salary") {
    const ask = profile.salary;
    if (ask.kind !== "pedir") {
      const why =
        "reason" in ask
          ? ask.reason
          : ask.kind === "bajo_piso"
            ? `el rango máximo (USD ${ask.maxUsd}) está bajo el piso (USD ${ask.floorUsd})`
            : "el piso del perfil y el de los criterios no coinciden";
      return emptyFixed(q, "salario", `sueldo sin calcular (${ask.kind}): ${why}. Decidilo vos.`);
    }
    const es = isSpanish(q.text);
    return {
      question_id: q.id,
      question: q.text,
      origin: "salario",
      draft: es ? `USD ${ask.usdMonthly} mensuales` : `USD ${ask.usdMonthly} per month`,
      sources: [],
      confidence: "alta",
      note: `calculado por el sistema (${ask.basis})`,
    };
  }

  const fixed = profile.fixed_answers;
  if ("marca" in fixed) return emptyFixed(q, "fija", "sin cargar: completá applicant:sync");

  let value: string | undefined;
  if (kind === "availability") value = fixed.availability;
  else if (kind === "contract") value = fixed.contract;
  else if (kind === "work_authorization") value = fixed.work_authorization;
  else {
    const t = fold(q.text);
    const wanted = (["linkedin", "github", "portfolio"] as const).filter(
      (k) => t.includes(k) || (k === "portfolio" && /\b(website|site|sitio web)\b/.test(t)),
    );
    const keys = wanted.length > 0 ? wanted : (["linkedin", "github", "portfolio"] as const);
    const lines = keys.flatMap((k) => (fixed.links[k] ? [[k, fixed.links[k]] as const] : []));
    value =
      lines.length === 0
        ? undefined
        : lines.length === 1
          ? lines[0]![1]
          : lines.map(([k, url]) => `${k}: ${url}`).join("\n");
  }
  if (!value || value === NOT_LOADED)
    return emptyFixed(q, "fija", "sin cargar: completá applicant:sync");
  return {
    question_id: q.id,
    question: q.text,
    origin: "fija",
    draft: value,
    sources: [],
    confidence: "alta",
    note: "respuesta fija, copiada de application_settings",
  };
}

const MAX_JD_CHARS = 8000;
const MAX_PREVIOUS_ANSWERS = 6;

/** El aviso entra en el prompt entre marcas: se le quitan las propias para que no pueda cerrarlas. */
function sanitizeJd(jd: string): string {
  return jd.replace(/<\/?\s*aviso_no_confiable\s*>/gi, "").slice(0, MAX_JD_CHARS);
}

/**
 * Valida lo que devolvió el modelo contra la tabla real de hechos. Sin fuente válida no hay
 * afirmación: el borrador se vacía y se marca "sin fuente".
 */
function validateModelDraft(
  q: FormQuestion,
  raw: DraftApplicationAnswersOutput["drafts"][number] | undefined,
  validKeys: Set<string>,
): DraftedAnswer {
  const base = { question_id: q.id, question: q.text, origin: "modelo" as const };
  const noSource = (invalid: string[] = []): DraftedAnswer => ({
    ...base,
    draft: "",
    sources: [],
    confidence: "baja",
    note: SIN_FUENTE,
    ...(invalid.length > 0 ? { invalid_sources: invalid } : {}),
  });
  if (!raw) return noSource();

  const draft = raw.draft.trim();
  if (!draft) {
    return { ...noSource(), note: raw.note?.trim() || SIN_FUENTE };
  }
  const cited = [...new Set(raw.sources.map((k) => k.trim()).filter(Boolean))];
  const invalid = cited.filter((k) => !validKeys.has(k));
  if (cited.length === 0 || invalid.length > 0) return noSource(invalid);
  return {
    ...base,
    draft,
    sources: cited,
    confidence: raw.confidence,
    ...(raw.note?.trim() ? { note: raw.note.trim() } : {}),
  };
}

export async function draftApplicationAnswers(
  db: Db,
  input: { userId: string; jobId: string; questions: FormQuestion[] },
  llm: LlmClient,
  capGuard?: () => Promise<string | null>,
): Promise<DraftApplicationAnswersResult> {
  const { userId, jobId } = input;
  const questions = input.questions.map((q) => ({ id: q.id.trim(), text: q.text.trim() }));
  if (questions.length === 0) throw new ApplicantFailure("empty_form");
  if (questions.some((q) => !q.id || !q.text)) throw new ApplicantFailure("empty_question");
  if (new Set(questions.map((q) => q.id)).size !== questions.length) {
    throw new ApplicantFailure("empty_question", "ids de pregunta duplicados");
  }

  // Valida la oferta y el perfil (lanza ApplicantFailure) y trae respuestas fijas y sueldo.
  const profile = await getCandidateProfile(db, { userId, jobId });

  const results = new Map<string, DraftedAnswer>();
  const forModel: FormQuestion[] = [];
  for (const q of questions) {
    const kind = classifyFixed(q.text);
    if (kind) results.set(q.id, fixedDraft(q, kind, profile));
    else forModel.push(q);
  }

  let llmInfo: DraftApplicationAnswersResult["llm"] = null;
  let llmError: LlmError | null = null;

  let capMessage: string | null = null;
  if (forModel.length > 0) capMessage = (await capGuard?.()) ?? null;
  if (capMessage) {
    for (const q of forModel) {
      results.set(q.id, {
        question_id: q.id,
        question: q.text,
        origin: "modelo",
        draft: "",
        sources: [],
        confidence: "baja",
        note: `${capMessage} Redactala vos.`,
      });
    }
  } else if (forModel.length > 0) {
    // getCandidateProfile no expone la clave de cada hecho; hace falta para citar y para validar.
    const facts = await db
      .select({
        key: s.candidateFacts.key,
        project: s.candidateFacts.project,
        claim: s.candidateFacts.claim,
        metric: s.candidateFacts.metric,
        verification: s.candidateFacts.verification,
      })
      .from(s.candidateFacts)
      .where(and(eq(s.candidateFacts.userId, userId), eq(s.candidateFacts.active, true)))
      .orderBy(asc(s.candidateFacts.sort), asc(s.candidateFacts.key));
    const validKeys = new Set(facts.map((f) => f.key));

    const [job] = await db
      .select({ title: s.jobs.title, jdText: s.jobs.jdText })
      .from(s.jobs)
      .where(and(eq(s.jobs.id, jobId), eq(s.jobs.userId, userId)));

    const previous = new Map<string, BankAnswer>();
    for (const q of forModel) {
      for (const a of await listAnswers(db, { userId, query: q.text, limit: 2 })) {
        previous.set(a.id, a);
      }
    }

    // Sin resumen, años ni inglés: son afirmaciones sin clave y el modelo las repetiría como hechos.
    const profileForModel = {
      location: profile.profile.location,
      remote_only: profile.profile.remote_only,
      timezone: profile.profile.timezone,
    };
    const vars = {
      facts: JSON.stringify(facts.length > 0 ? facts : NO_FACTS),
      profile: JSON.stringify(profileForModel),
      previous_answers: JSON.stringify(
        [...previous.values()]
          .slice(0, MAX_PREVIOUS_ANSWERS)
          .map((a) => ({ question: a.question, answer: a.answer, lang: a.lang })),
      ),
      job_title: job?.title ?? "",
      job: sanitizeJd(job?.jdText ?? "(sin texto del aviso)"),
      questions: JSON.stringify(forModel),
    };

    const r = await llm.generateStructured(
      "draft_application_answers",
      DraftApplicationAnswersSchema,
      vars,
      { userId, jobId },
    );
    if (r.ok) {
      llmInfo = {
        model: r.value.model,
        promptVersion: r.value.promptVersion,
        costUsd: r.value.costUsd,
        usedFallback: r.value.usedFallback,
      };
      const byId = new Map<string, DraftApplicationAnswersOutput["drafts"][number]>();
      for (const d of r.value.object.drafts)
        if (!byId.has(d.question_id)) byId.set(d.question_id, d);
      for (const q of forModel) results.set(q.id, validateModelDraft(q, byId.get(q.id), validKeys));
    } else {
      llmError = r.error;
      for (const q of forModel) {
        results.set(q.id, {
          question_id: q.id,
          question: q.text,
          origin: "modelo",
          draft: "",
          sources: [],
          confidence: "baja",
          note: `el modelo no respondió (${r.error.kind}): redactala vos`,
        });
      }
    }
  }

  return {
    drafts: questions.map((q) => results.get(q.id)!),
    llm: llmInfo,
    llm_error: llmError,
    ...(capMessage ? { cap_message: capMessage } : {}),
  };
}
