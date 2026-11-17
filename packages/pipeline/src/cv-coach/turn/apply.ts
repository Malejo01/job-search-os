/**
 * Un turno de la charla del coach de CV (ADR-038 §2, §3 y §5). Puro. El temario es la lista de problemas
 * que ordenó el código (R12-8): el modelo extrae y propone el texto de la próxima pregunta, pero **el código
 * decide** qué problema quedó resuelto (por tipo, mirando las tarjetas), cuándo se repregunta, cuándo se
 * saltea y cuál es el siguiente. `declined` cierra el problema sin repreguntar.
 *
 * - Resuelto (por tipo): ver `coachIssueResolved`. Lo dicho fuera de foco también puede resolver otros
 *   problemas de la lista (no se vuelve a preguntar lo que ya dijo).
 * - «No tengo» / «no sé» / «prefiero no» (`declined`, el botón o el texto): el problema va a `skipped`.
 * - Respuesta ilegible (ninguna tarjeta ni dato repetido, o salida inválida): suma una falla; con
 *   `CV_COACH_MAX_FAILURES_PER_ISSUE` se saltea.
 * - Respuesta útil pero insuficiente: repregunta, hasta `CV_COACH_MAX_FOLLOW_UPS`; después se saltea.
 * - El siguiente problema es el primero de la lista que no está resuelto ni salteado.
 */
import { cvDeclined } from "../../cv-chat/follow-up";
import { foldCvText } from "../../cv-out/verify";
import { hasConcreteDuty } from "../../profile-agent/gaps/detect";
import { err, ok, type Result } from "../../result";
import {
  CV_COACH_MAX_FAILURES_PER_ISSUE,
  CV_COACH_MAX_FOLLOW_UPS,
  CV_COACH_MAX_TURNS,
} from "../limits";
import type { CvCoachState, CvCoachTurnOutput, CvIssue } from "../schemas";
import {
  COACH_ACK_CHOICE,
  COACH_ACK_DECLINED,
  COACH_ACK_UNREADABLE,
  coachAck,
  coachConflictQuestion,
  type CoachConflictQuestion,
} from "./ack";
import { buildCoachCards, type CoachDropReason, type CvCoachCard } from "./cards";
import { coachItemFor, type CvCoachTurnContext } from "./context";
import { resolveCoachQuestion, type CoachQuestion } from "./question";
import type { CoachFallbacks } from "./templates";

type IssueId = CvIssue["id"];

export type CoachTurnSetup = CvCoachTurnContext & {
  issues: readonly CvIssue[];
  fallbacks: CoachFallbacks;
};

/** Qué respondió la persona en este turno, ya resuelto por el adaptador. */
export type CoachTurnInput =
  /** Texto que pasó por `cv_coach_turn`. `output` `null` = la salida no sirvió (cuenta como ilegible). */
  | { kind: "model"; issueId: IssueId; message: string; output: CvCoachTurnOutput | null }
  /** «No tengo» (el botón, o un texto corto que el código reconoce sin llamar al modelo). */
  | { kind: "declined"; issueId: IssueId }
  /** Eligió una de las dos opciones de una contradicción: no cambia el temario. */
  | { kind: "choice"; issueId: IssueId; choice: 0 | 1 };

export type CoachCloseReason = "lista_agotada" | "listo" | "turnos";

export type CoachTurnResult = {
  state: CvCoachState;
  /** Tarjetas para confirmar: nada entra al CV sin el clic. */
  cards: CvCoachCard[];
  /** Por qué se descartaron tarjetas (solo motivos, nunca el texto). */
  dropped: CoachDropReason[];
  /** Acuse armado por el código, o `null`. */
  ack: string | null;
  /** Contradicción con el CV: se muestra antes de la pregunta, con dos botones. */
  conflict: CoachConflictQuestion | null;
  /** Próxima pregunta, o `null` si la charla terminó. */
  question: CoachQuestion | null;
  resolvedNow: IssueId[];
  skippedNow: IssueId[];
  closeReason: CoachCloseReason | null;
};

export type CoachTurnError = "foco_invalido" | "charla_cerrada";

const fold = (s: string): string => foldCvText(s).replace(/\s+/g, " ").trim();

function mentions(texts: readonly string[], term: string): boolean {
  const t = fold(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (t.length < 1) return false;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${t}(?![\\p{L}\\p{N}])`, "u");
  return texts.some((x) => re.test(fold(x)));
}

/** Textos de las tarjetas que cuentan como evidencia de una skill. */
function evidenceTexts(cards: readonly CvCoachCard[]): string[] {
  return cards.flatMap((c) => {
    switch (c.kind) {
      case "bullets":
        return c.bullets;
      case "stack":
        return c.stack;
      case "new_item":
      case "note":
        return [c.text];
      default:
        return [];
    }
  });
}

/**
 * ¿Las tarjetas de este turno resuelven el problema? Decide el código, por tipo:
 * - `logro_sin_resultado`, `vineta_sin_verbo`: una viñeta nueva para ese ítem.
 * - `tarea_vaga`: una viñeta nueva concreta (cuatro palabras o más) para ese ítem.
 * - `proyecto_sin_stack_o_link`: stack, link o una herramienta dicha para ese proyecto.
 * - `skill_pedida_sin_evidencia`, `brecha_con_puesto`: la skill aparece en alguna tarjeta.
 * - `fecha_faltante`: el ítem queda con inicio y con fin (o «sigo ahí»).
 * - `inconsistencia`: fechas o nombres aclarados para ese ítem.
 * - `resumen_generico`, `orden_poco_relevante` y los problemas sin ítem: solo en foco, con alguna tarjeta.
 */
export function coachIssueResolved(
  issue: CvIssue,
  cards: readonly CvCoachCard[],
  setup: CvCoachTurnContext,
  isFocus: boolean,
): boolean {
  if (issue.type === "skill_pedida_sin_evidencia" || issue.type === "brecha_con_puesto") {
    const name = issue.skillSlug ? setup.skillNames[issue.skillSlug] : undefined;
    if (name) {
      const aliases = (issue.skillSlug && setup.skillAliases?.[issue.skillSlug]) || [];
      const texts = evidenceTexts(cards);
      // Alias de una o dos letras («R», «Go») darían falsos positivos: se usan desde tres caracteres
      return [name, ...aliases.filter((a) => a.trim().length >= 3)].some((t) => mentions(texts, t));
    }
    return isFocus && cards.length > 0;
  }
  const item = coachItemFor(issue, setup);
  if (item === null) return isFocus && cards.length > 0;
  const mine = cards.filter((c) => "historyId" in c && c.historyId === item.id);
  switch (issue.type) {
    case "logro_sin_resultado":
    case "vineta_sin_verbo":
      return mine.some((c) => c.kind === "bullets");
    case "tarea_vaga":
      return mine.some((c) => c.kind === "bullets" && hasConcreteDuty(c.bullets));
    case "proyecto_sin_stack_o_link":
      return mine.some(
        (c) =>
          c.kind === "stack" ||
          c.kind === "link" ||
          (c.kind === "bullets" && c.source === "herramienta"),
      );
    case "fecha_faltante":
      return mine.some(
        (c) => c.kind === "dates" && c.startMonth !== null && (c.endMonth !== null || c.isCurrent),
      );
    case "inconsistencia":
      return mine.some((c) => c.kind === "dates" || c.kind === "names");
    case "resumen_generico":
    case "orden_poco_relevante":
      return isFocus && cards.length > 0;
  }
}

const isOpen = (s: CvCoachState, id: IssueId): boolean =>
  !s.resolved.includes(id) && !s.skipped.includes(id);

/** Primer problema abierto según el orden de la lista. */
export function nextCoachIssue(issues: readonly CvIssue[], s: CvCoachState): CvIssue | null {
  return issues.find((i) => isOpen(s, i.id)) ?? null;
}

/** Estado inicial y primera pregunta (de plantilla: no hay llamada al modelo antes del primer mensaje). */
export function startCoachChat(setup: CoachTurnSetup): {
  state: CvCoachState;
  question: CoachQuestion | null;
} {
  const first = setup.issues[0] ?? null;
  const state: CvCoachState = {
    stage: first ? "chat" : "done",
    current: first?.id ?? null,
    resolved: [],
    skipped: [],
    followUps: 0,
    failures: 0,
    turnsShown: 0,
  };
  const question = first
    ? resolveCoachQuestion({
        draft: null,
        issue: first,
        followUp: false,
        ctx: setup,
        fallbacks: setup.fallbacks,
        messages: [],
      })
    : null;
  return { state, question };
}

/** «Ya está, armalo» o un tope: la charla pasa al cierre con lo que confirmó. */
export function finishCoachChat(state: CvCoachState): CvCoachState {
  return { ...state, stage: "done", current: null, followUps: 0, failures: 0 };
}

function questionFor(
  setup: CoachTurnSetup,
  issue: CvIssue,
  followUp: boolean,
  draft: string | null,
  messages: readonly string[],
): CoachQuestion {
  return resolveCoachQuestion({
    draft,
    issue,
    followUp,
    ctx: setup,
    fallbacks: setup.fallbacks,
    messages,
  });
}

export function applyCoachTurn(
  setup: CoachTurnSetup,
  state: CvCoachState,
  input: CoachTurnInput,
): Result<CoachTurnResult, CoachTurnError> {
  if (state.stage === "done" || state.current === null) return err("charla_cerrada");
  const focus = setup.issues.find((i) => i.id === state.current);
  if (!focus || focus.id !== input.issueId || !isOpen(state, focus.id)) return err("foco_invalido");

  const base: Omit<CoachTurnResult, "state" | "question" | "closeReason"> = {
    cards: [],
    dropped: [],
    ack: null,
    conflict: null,
    resolvedNow: [],
    skippedNow: [],
  };

  // Contradicción: la persona eligió; el temario no cambia y no hay modelo
  if (input.kind === "choice") {
    const repeat = state.followUps > 0 || state.failures > 0;
    return ok({
      ...base,
      state,
      ack: COACH_ACK_CHOICE[input.choice],
      question: questionFor(setup, focus, repeat, null, []),
      closeReason: null,
    });
  }

  const messages = input.kind === "model" ? [input.message] : [];
  const built =
    input.kind === "model" && input.output !== null
      ? buildCoachCards(input.output, coachItemFor(focus, setup), setup, input.message)
      : { cards: [], dropped: [], unchanged: 0, conflicts: [] };
  const declined =
    input.kind === "declined" ||
    (input.kind === "model" && (cvDeclined(input.message) || input.output?.declined === true));
  const turnsShown =
    input.kind === "model" ? Math.min(state.turnsShown + 1, CV_COACH_MAX_TURNS) : state.turnsShown;

  // Qué quedó resuelto: el problema en foco y cualquier otro abierto que las tarjetas cubran
  const resolvedNow = setup.issues
    .filter((i) => isOpen(state, i.id))
    .filter((i) => coachIssueResolved(i, built.cards, setup, i.id === focus.id))
    .map((i) => i.id);
  const focusResolved = resolvedNow.includes(focus.id);
  const readable = built.cards.length > 0 || built.unchanged > 0;

  let next: CvCoachState = {
    ...state,
    turnsShown,
    resolved: [...state.resolved, ...resolvedNow],
  };
  const skippedNow: IssueId[] = [];
  let stay = false;
  if (!focusResolved) {
    if (declined) skippedNow.push(focus.id);
    else if (!readable) {
      const failures = state.failures + 1;
      if (failures >= CV_COACH_MAX_FAILURES_PER_ISSUE) skippedNow.push(focus.id);
      else {
        next = { ...next, failures };
        stay = true;
      }
    } else if (state.followUps < CV_COACH_MAX_FOLLOW_UPS) {
      next = { ...next, followUps: state.followUps + 1 };
      stay = true;
    } else skippedNow.push(focus.id);
  }
  next = { ...next, skipped: [...next.skipped, ...skippedNow] };

  const draft = input.kind === "model" ? (input.output?.nextQuestion ?? null) : null;
  const ack =
    coachAck(built.cards, setup) ??
    (declined ? COACH_ACK_DECLINED : readable ? null : COACH_ACK_UNREADABLE);
  const conflict = built.conflicts[0] ? coachConflictQuestion(built.conflicts[0]) : null;
  const shared = {
    ...base,
    cards: built.cards,
    dropped: built.dropped,
    ack,
    conflict,
    resolvedNow,
    skippedNow,
  };

  if (stay) {
    return ok({
      ...shared,
      state: next,
      question: questionFor(setup, focus, true, draft, messages),
      closeReason: null,
    });
  }
  const upcoming = nextCoachIssue(setup.issues, next);
  if (upcoming === null) {
    return ok({
      ...shared,
      state: finishCoachChat(next),
      question: null,
      closeReason: "lista_agotada",
    });
  }
  next = { ...next, current: upcoming.id, followUps: 0, failures: 0 };
  return ok({
    ...shared,
    state: next,
    question: questionFor(setup, upcoming, false, draft, messages),
    closeReason: null,
  });
}
