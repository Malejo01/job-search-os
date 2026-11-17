import {
  createLogger,
  dbCoachTurnReserve,
  loadCoachFallbacks,
  originAllowed,
  runCoachTurn,
  signProfileAgentTicket,
  verifyCvCoachIssues,
  verifyProfileAgentTicket,
  type CoachTurnRejectReason,
} from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  cvCoachAnswerSchema,
  cvCoachCardSchema,
  cvCoachStateSchema,
  profileAgentDailyCapUsd,
  resolveCoachQuestion,
  revalidateCvIssues,
  screenCoachCard,
  startCoachChat,
  type CoachTurnSetup,
} from "@job-search-os/pipeline";
import { z } from "zod";
import { requireCvCoach } from "@/lib/cv-coach/access";
import { saveCoachCard } from "@/lib/cv-coach/cards-server";
import { cvCoachItems, cvCoachSkillNames, loadCvCoachContext } from "@/lib/cv-coach/context";
import { serviceLlm } from "@/lib/llm-service";
import { sessionUserId } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { needsTermsAcceptance } from "@/lib/terms-status";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Charla del coach de CV (ADR-038 §5, R12-10). Orden (O7 de ADR-034): sesión (401, sin tocar la base ni el
 * modelo) → flag `cvCoachAllowed` (404) → ticket del agente de perfil y lista firmada (409) → topes (429,
 * mensaje fijo, dentro de `runCoachTurn`). Lo confirmado se lee acá con RLS y la lista firmada se vuelve a
 * validar contra eso (`revalidateCvIssues`). No se guarda la charla: el avance viaja por el navegador y solo
 * se escribe en `career_history` la tarjeta que la persona confirma con el clic. Nunca se devuelve el texto
 * de una excepción, del modelo ni de la respuesta de la persona.
 *
 * Acciones: `start` (primera pregunta, de plantilla; con un avance válido, retoma la pregunta en foco),
 * `answer` (un turno: como mucho una llamada a `cv_coach_turn`; «Ya está, armalo» no llama al modelo) y
 * `confirm` (guarda una tarjeta).
 */
const MAX_BODY_CHARS = 30_000;

type ErrorCode =
  | "unauthorized"
  | "not_found"
  | "bad_origin"
  | "not_ready"
  | "bad_request"
  | "bad_ticket"
  | "bad_issues"
  | "too_long"
  | "empty"
  | "injection"
  | "pasted_cv"
  | "sensitive"
  | "cv_injection"
  | "bad_answer"
  | "invalid_card"
  | "unsupported_card"
  | "llm_unavailable"
  | "server";

const MESSAGES: Record<ErrorCode, string> = {
  unauthorized: "Iniciá sesión para seguir.",
  not_found: "No encontramos esta página.",
  bad_origin: "Pedido no permitido.",
  not_ready: "Antes completá los términos.",
  bad_request: "No entendimos el pedido. Recargá la página e intentá de nuevo.",
  bad_ticket:
    "La charla venció. Volvé a empezar la lectura de tu CV; lo que ya confirmaste sigue en tu perfil.",
  bad_issues:
    "No pudimos seguir con esta revisión. Volvé al diagnóstico para empezarla de nuevo; lo que confirmaste sigue en tu perfil.",
  too_long: "La respuesta es muy larga. Contalo en pocas líneas.",
  empty: "Escribí una respuesta o tocá «No tengo».",
  injection:
    "No pudimos usar esa respuesta. Contestá la pregunta con tus palabras o tocá «No tengo».",
  pasted_cv:
    "Parece que pegaste un CV entero. Acá te preguntamos de a una cosa: contestá con tus palabras.",
  sensitive:
    "Esa respuesta tiene datos personales que no guardamos. Contestá solo sobre tu trabajo o tocá «No tengo».",
  cv_injection:
    "Tu CV tiene un texto que no podemos usar con la IA. Revisalo desde Historial o armá tu CV con lo que confirmaste.",
  bad_answer: "Esa respuesta no corresponde a esta pregunta. Recargá la página e intentá de nuevo.",
  invalid_card: "No pudimos guardar ese cambio. Revisá tu historial a mano desde las pantallas.",
  unsupported_card: "Esto lo podés sumar a mano desde Historial.",
  llm_unavailable:
    "Ahora no puedo responder. Probá de nuevo en un rato o armá tu CV con lo que ya confirmaste.",
  server: "No pudimos completar el pedido. Probá de nuevo en un rato.",
};

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  not_found: 404,
  bad_origin: 403,
  not_ready: 403,
  bad_request: 400,
  bad_ticket: 409,
  bad_issues: 409,
  too_long: 413,
  empty: 422,
  injection: 422,
  pasted_cv: 422,
  sensitive: 422,
  cv_injection: 422,
  bad_answer: 422,
  invalid_card: 422,
  unsupported_card: 422,
  llm_unavailable: 503,
  server: 500,
};

const NO_STORE = { "Cache-Control": "no-store" };

function fail(code: ErrorCode, extra: Record<string, unknown> = {}): Response {
  return Response.json(
    { ok: false, error: code, message: MESSAGES[code], ...extra },
    { status: STATUS[code], headers: NO_STORE },
  );
}

const REJECT_CODES: Record<CoachTurnRejectReason, ErrorCode> = {
  empty: "empty",
  too_long: "too_long",
  injection: "injection",
  pasted_cv: "pasted_cv",
  sensitive: "sensitive",
  cv_injection: "cv_injection",
  foco_invalido: "bad_answer",
  charla_cerrada: "bad_answer",
};

const ticketField = z.string().max(300);
const requestSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("start"),
    ticket: ticketField,
    issues: z.unknown(),
    state: z.unknown().optional(),
  }),
  z.strictObject({
    action: z.literal("answer"),
    ticket: ticketField,
    issues: z.unknown(),
    state: z.unknown(),
    answer: z.unknown(),
  }),
  z.strictObject({
    action: z.literal("confirm"),
    ticket: ticketField,
    issues: z.unknown(),
    card: z.unknown(),
  }),
]);

export async function POST(request: Request): Promise<Response> {
  // 1) sesión → 2) flag (apagado = 404, sin tocar el modelo)
  const access = await requireCvCoach(sessionUserId);
  if (!access.ok) return fail(access.stage === "session" ? "unauthorized" : "not_found");
  const userId = access.userId;
  const allowed = [new URL(request.url).origin, siteUrl()];
  if (process.env.AUTH_URL) allowed.push(process.env.AUTH_URL);
  if (!originAllowed(request.headers.get("origin"), allowed)) return fail("bad_origin");
  if (await needsTermsAcceptance(userId)) return fail("not_ready");

  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return fail("too_long");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail("bad_request");
  }
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) return fail("bad_request");
  const req = parsed.data;

  // 3) ticket del agente de perfil y lista firmada de esta charla
  const now = Date.now();
  const secret = process.env.AUTH_SECRET;
  const ticket = verifyProfileAgentTicket(secret, userId, req.ticket, now);
  if (!ticket) return fail("bad_ticket");
  const flowId = ticket.flowId;
  const list = verifyCvCoachIssues(secret, userId, req.issues, { flowId, nowMs: now });
  if (!list) return fail("bad_issues");
  const logger = createLogger({ user_id: userId, run_id: flowId, trigger: "cv_coach_turn" });
  const renew = (): string | null => signProfileAgentTicket(secret, userId, { flowId }, Date.now());

  let conn = null as ReturnType<typeof createDb> | null;
  try {
    if (req.action === "confirm") {
      const card = cvCoachCardSchema.safeParse(req.card);
      // la tarjeta vuelve del navegador: entrada no confiable, se revalida y se vuelve a filtrar
      if (!card.success || screenCoachCard(card.data) !== null) return fail("invalid_card");
      const saved = await saveCoachCard(userId, card.data);
      if (!saved.ok) {
        return fail(saved.reason === "unsupported" ? "unsupported_card" : "invalid_card", {
          href: "/settings/historial",
        });
      }
      logger.info({ kind: card.data.kind }, "coach: tarjeta guardada");
      return Response.json({ ok: true, saved: true }, { headers: NO_STORE });
    }

    const fallbacks = loadCoachFallbacks();
    if (!fallbacks.ok) {
      logger.error({ kind: fallbacks.error.kind }, "coach: plantillas de respaldo");
      return fail("server");
    }
    const { ctx } = await loadCvCoachContext(userId);
    // La lista se vuelve a validar contra lo confirmado hoy: un ítem borrado o una cita que ya no está caen
    const issues = revalidateCvIssues(list.issues, ctx);
    const items = cvCoachItems(ctx.items);
    const skillNames = cvCoachSkillNames(
      ctx,
      issues.map((i) => i.skillSlug),
    );
    const setup: CoachTurnSetup = {
      items,
      skillNames,
      target: list.target,
      issues,
      fallbacks: fallbacks.value,
    };

    if (req.action === "start") {
      const prev = cvCoachStateSchema.safeParse(req.state);
      const focus =
        prev.success && prev.data.stage === "chat" && prev.data.current
          ? issues.find((i) => i.id === prev.data.current)
          : undefined;
      const t = renew();
      if (!t) return fail("server");
      if (prev.success && focus) {
        // Retomar al recargar: la pregunta del problema en foco, de plantilla, sin gastar nada
        const question = resolveCoachQuestion({
          draft: null,
          issue: focus,
          followUp: prev.data.followUps > 0 || prev.data.failures > 0,
          ctx: setup,
          fallbacks: setup.fallbacks,
          messages: [],
        });
        return Response.json(
          { ok: true, ticket: t, state: prev.data, question, total: issues.length },
          { headers: NO_STORE },
        );
      }
      const started = startCoachChat(setup);
      return Response.json(
        { ok: true, ticket: t, ...started, total: issues.length },
        { headers: NO_STORE },
      );
    }

    // answer
    const state = cvCoachStateSchema.safeParse(req.state);
    const answer = cvCoachAnswerSchema.safeParse(req.answer);
    if (!state.success || !answer.success) return fail("bad_request");
    conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
    const db = conn.db;
    const out = await runCoachTurn(
      {
        llm: serviceLlm(db, logger),
        reserve: dbCoachTurnReserve(db, { dailyCapUsd: profileAgentDailyCapUsd(process.env) }),
      },
      {
        userId,
        flowId,
        issues,
        target: list.target,
        items,
        skillNames,
        state: state.data,
        answer: answer.data,
        now: new Date(now),
        signal: request.signal,
      },
    );
    const t = renew();
    if (!t) return fail("server");
    switch (out.kind) {
      case "rejected":
        return fail(REJECT_CODES[out.reason]);
      case "templates":
        logger.error({ kind: out.error.kind }, "coach: plantillas de respaldo");
        return fail("server");
      case "error":
        logger.warn({ llm_error: out.error.kind }, "coach: el modelo no respondió");
        return fail("llm_unavailable");
      case "cap":
        return Response.json(
          {
            ok: false,
            error: "capped",
            cap: out.reject,
            ...out.notice,
            ticket: t,
            state: out.state,
          },
          { status: 429, headers: NO_STORE },
        );
      case "finished":
        return Response.json(
          { ok: true, ticket: t, state: out.state, finished: true },
          { headers: NO_STORE },
        );
      case "turn":
        logger.info(
          {
            used_model: out.usedModel,
            cards: out.result.cards.length,
            dropped: out.result.dropped.length,
            question_source: out.result.question?.source ?? null,
            question_rejected: out.result.question?.rejected ?? null,
            resolved: out.result.resolvedNow.length,
            skipped: out.result.skippedNow.length,
          },
          "coach: turno",
        );
        return Response.json(
          {
            ok: true,
            ticket: t,
            state: out.result.state,
            cards: out.result.cards,
            dropped: out.result.dropped.length,
            ack: out.result.ack,
            conflict: out.result.conflict,
            question: out.result.question,
            resolvedNow: out.result.resolvedNow,
            skippedNow: out.result.skippedNow,
            closeReason: out.result.closeReason,
          },
          { headers: NO_STORE },
        );
    }
    return fail("server");
  } catch {
    // Nunca el mensaje de la excepción: puede citar datos de la persona
    logger.error({}, "coach: turno falló");
    return fail("server");
  } finally {
    await conn?.close();
  }
}
