import {
  createLogger,
  cvChatLabel,
  loadGapTemplates,
  newCvConversationId,
  originAllowed,
  releaseCvChatReservation,
  reserveGapStep,
  runGapTurn,
  signProfileAgentTicket,
  verifyProfileAgentTicket,
  type GapReject,
} from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl, type Db } from "@job-search-os/db";
import {
  closeGap,
  cvChatCapNotice,
  gapCardKeyMatches,
  gapRefFromKey,
  nextGapQuestion,
  openGapFollowUp,
  profileAgentCapNotice,
  profileAgentDailyCapUsd,
  profileGapAnswerSchema,
  profileGapCardSchema,
  profileGapStateSchema,
  screenProfileCard,
  withOpenGap,
  type GapTemplates,
  type ProfileGapState,
} from "@job-search-os/pipeline";
import { z } from "zod";
import {
  loadGapContext,
  profileAgentAllowedFor,
  saveGapCard,
} from "@/lib/profile-agent/gaps-server";
import { serviceLlm } from "@/lib/llm-service";
import { sessionUserId } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { needsTermsAcceptance } from "@/lib/terms-status";

export const dynamic = "force-dynamic";

/**
 * Etapa de huecos del agente de perfil (ADR-034, R10-3). Orden de los chequeos (O7): sesión (401) → flag
 * (404, sin tocar el modelo) → ticket (409) → tope (429, mensaje fijo). La charla no se guarda: el ticket
 * firmado solo lleva el `flowId`, y los turnos y el gasto salen de `llm_calls` por `label`. Los huecos se
 * calculan acá, con RLS, a partir de lo que ya está en la base. Nunca se devuelve el texto de una excepción,
 * del modelo ni de la respuesta de la persona.
 */
const MAX_BODY_CHARS = 20_000;

type ErrorCode =
  | "unauthorized"
  | "not_found"
  | "bad_origin"
  | "not_ready"
  | "bad_request"
  | "bad_ticket"
  | "too_long"
  | "empty"
  | "injection"
  | "pasted_cv"
  | "sensitive"
  | "bad_answer"
  | "invalid_card"
  | "llm_unavailable"
  | "server";

/** Mensajes fijos para la persona. */
const MESSAGES: Record<ErrorCode, string> = {
  unauthorized: "Iniciá sesión para seguir.",
  not_found: "No encontramos esta página.",
  bad_origin: "Pedido no permitido.",
  not_ready: "Antes completá los términos.",
  bad_request: "No entendimos el pedido. Recargá la página e intentá de nuevo.",
  bad_ticket:
    "La charla venció. Volvé a empezar la lectura de tu CV; lo que ya confirmaste sigue en tu perfil.",
  too_long: "La respuesta es muy larga. Contalo en pocas líneas.",
  empty: "Escribí una respuesta o tocá «No tengo».",
  injection:
    "No pudimos usar esa respuesta. Contestá la pregunta con tus palabras o tocá «No tengo».",
  pasted_cv:
    "Parece que pegaste un CV entero. Acá te preguntamos de a una cosa: contestá con tus palabras o cargá tu historial a mano.",
  sensitive:
    "Esa respuesta tiene datos personales que no guardamos en tu perfil. Contestá solo sobre tu trabajo o tocá «No tengo».",
  bad_answer: "Esa respuesta no corresponde a esta pregunta. Recargá la página e intentá de nuevo.",
  invalid_card: "No pudimos guardar esos cambios. Revisá tu historial a mano desde las pantallas.",
  llm_unavailable:
    "Ahora no puedo responder. Podés completar tu perfil a mano desde las pantallas y volver más tarde.",
  server: "No pudimos completar el pedido. Probá de nuevo en un rato.",
};

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  not_found: 404,
  bad_origin: 403,
  not_ready: 403,
  bad_request: 400,
  bad_ticket: 409,
  too_long: 413,
  empty: 422,
  injection: 422,
  pasted_cv: 422,
  sensitive: 422,
  bad_answer: 422,
  invalid_card: 422,
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

function capped(reject: GapReject): Response {
  const notice = reject === "inicios" ? cvChatCapNotice("inicios") : profileAgentCapNotice(reject);
  return Response.json(
    { ok: false, error: "capped", cap: reject, ...notice },
    { status: 429, headers: NO_STORE },
  );
}

function succeed(body: Record<string, unknown>): Response {
  return Response.json({ ok: true, ...body }, { headers: NO_STORE });
}

const requestSchema = z.discriminatedUnion("action", [
  // Charla nueva: ignora cualquier ticket (también el vencido o inválido) y cuenta en los 5 por día (O3)
  z.strictObject({ action: z.literal("start"), ticket: z.string().max(300).optional() }),
  z.strictObject({
    action: z.literal("answer"),
    ticket: z.string().max(300),
    gaps: z.unknown(),
    answer: z.unknown(),
  }),
  // Retomar al recargar la página: devuelve la pregunta vigente sin consumir nada ni abrir otra charla
  z.strictObject({ action: z.literal("resume"), ticket: z.string().max(300), gaps: z.unknown() }),
  z.strictObject({
    action: z.literal("skip"),
    ticket: z.string().max(300),
    gaps: z.unknown(),
    key: z.string().max(80),
  }),
  z.strictObject({ action: z.literal("confirm"), ticket: z.string().max(300), card: z.unknown() }),
]);

const SENSITIVE_NOTICE =
  "Dejé afuera esa respuesta porque tenía datos personales que no guardamos en tu perfil.";

export async function POST(request: Request): Promise<Response> {
  // 1) sesión
  const userId = await sessionUserId();
  if (!userId) return fail("unauthorized");
  // 2) flag: apagado = 404, sin tocar el modelo
  if (!(await profileAgentAllowedFor(userId))) return fail("not_found");
  // mismo origen, siempre: es un POST con cookie de sesión
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

  const now = Date.now();
  const secret = process.env.AUTH_SECRET;
  const logger = createLogger({ user_id: userId, trigger: "cv_profile_gaps" });

  // 3) ticket (la charla nueva no lo usa: abre un `flowId` propio)
  let flowId: string;
  if (req.action === "start") {
    flowId = newCvConversationId();
  } else {
    const t = verifyProfileAgentTicket(secret, userId, req.ticket, now);
    if (!t) return fail("bad_ticket");
    flowId = t.flowId;
  }
  const label = cvChatLabel(flowId);
  const issue = (): string | null => signProfileAgentTicket(secret, userId, { flowId }, Date.now());

  let conn = null as ReturnType<typeof createDb> | null;
  try {
    // Confirmar una tarjeta no llama al modelo ni mide gasto: guarda lo que la persona ya aceptó
    if (req.action === "confirm") {
      const card = profileGapCardSchema.safeParse(req.card);
      // la tarjeta vuelve del navegador: entrada no confiable, se revalida y se vuelve a filtrar
      if (!card.success || !gapCardKeyMatches(card.data) || !screenProfileCard(card.data).ok) {
        return fail("invalid_card");
      }
      const saved = await saveGapCard(userId, card.data);
      if (!saved.ok) {
        return fail(saved.reason === "not_found" ? "bad_request" : "invalid_card");
      }
      logger.info({ run_id: flowId, field: card.data.field }, "perfil: tarjeta de huecos guardada");
      return succeed({ saved: true });
    }

    const gapsRaw = req.action === "start" ? null : req.gaps;
    const state: ProfileGapState | null =
      gapsRaw === null
        ? { answered: [], followUps: {}, current: null }
        : (() => {
            const p = profileGapStateSchema.safeParse(gapsRaw);
            return p.success ? p.data : null;
          })();
    if (!state) return fail("bad_request");

    const templates = loadGapTemplates();
    if (!templates.ok) {
      logger.error({ run_id: flowId, kind: templates.error.kind }, "perfil: plantillas de huecos");
      return fail("server");
    }
    const tpl: GapTemplates = templates.value;

    conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
    const db: Db = conn.db;
    const dailyCapUsd = profileAgentDailyCapUsd(process.env);
    const clock = (): { now: Date; daySince: Date } => ({
      now: new Date(now),
      daySince: new Date(now - 24 * 3600 * 1000),
    });
    const reserve = (step: "turn" | "check" | "start") =>
      reserveGapStep(db, { userId, label, step, dailyCapUsd, ...clock() });
    const release = async (id: string | null): Promise<void> => {
      if (!(await releaseCvChatReservation(db, id))) {
        logger.warn({ run_id: flowId }, "perfil: no se pudo borrar la reserva");
      }
    };

    // 4) tope. La charla nueva cuenta en los 5 por día aunque el pedido no traiga ticket (O3)
    if (req.action === "start") {
      const r = await reserve("start");
      if (!r.ok) return capped(r.reject);
      const ctx = await loadGapContext(userId);
      const next = nextGapQuestion({ templates: tpl, career: ctx.career, gaps: ctx.gaps, state });
      const t = issue();
      if (!t) return fail("server");
      return succeed({
        ticket: t,
        gaps: state,
        question: next?.question ?? null,
        total: ctx.gaps.length,
      });
    }

    const ctx = await loadGapContext(userId);

    if (req.action === "skip" || req.action === "resume") {
      const r = await reserve("check");
      if (!r.ok) return capped(r.reject);
      const ref = req.action === "skip" ? gapRefFromKey(req.key, ctx.history, ctx.skills) : null;
      const after = ref ? closeGap(state, ref.key) : state;
      const next = nextGapQuestion({
        templates: tpl,
        career: ctx.career,
        gaps: ctx.gaps,
        state: after,
      });
      const t = issue();
      if (!t) return fail("server");
      return succeed({
        ticket: t,
        gaps: after,
        question: next?.question ?? null,
        card: null,
        total: ctx.gaps.length,
      });
    }

    // answer
    const answer = profileGapAnswerSchema.safeParse(req.answer);
    if (!answer.success) return fail("bad_request");
    const ref = gapRefFromKey(answer.data.key, ctx.history, ctx.skills);
    if (!ref) return fail("bad_request");
    const row =
      ref.historyId === null ? null : (ctx.history.find((h) => h.id === ref.historyId) ?? null);
    // Solo las respuestas de texto llaman al modelo y reservan; «no tengo» y el nivel solo miden
    const usesModel = answer.data.kind === "text";
    const slot = await reserve(usesModel ? "turn" : "check");
    if (!slot.ok) return capped(slot.reject);
    let out;
    try {
      out = await runGapTurn(
        { llm: serviceLlm(db, logger) },
        {
          userId,
          flowId,
          ref,
          row,
          answer: answer.data,
          followUpsAsked: state.followUps[ref.key] ?? 0,
        },
      );
    } finally {
      await release(slot.reservationId);
    }
    if (out.kind === "rejected") {
      if (out.reason === "pasted_cv") return fail("pasted_cv", { href: "/settings/historial" });
      return fail(out.reason);
    }
    if (out.kind === "error") {
      logger.warn({ run_id: flowId, llm_error: out.error.kind }, "perfil: el modelo no respondió");
      return fail("llm_unavailable");
    }
    const after = out.followUp ? openGapFollowUp(state, ref.key) : closeGap(state, ref.key);
    const next = nextGapQuestion({
      templates: tpl,
      career: ctx.career,
      // el tema que sigue abierto vale aunque la tarjeta pendiente ya lo resolvería en la base
      gaps: withOpenGap(ctx.gaps, out.followUp ? ref : null),
      state: after,
    });
    const t = issue();
    if (!t) return fail("server");
    const dropped = out.cardReason === "sensitive" || out.cardReason === "injection";
    return succeed({
      ticket: t,
      gaps: after,
      card: out.card,
      // a qué trabajo o skill se refiere la tarjeta (texto que ya es de la persona, se muestra como texto)
      target: ref.skillName ?? ref.organization,
      notice: dropped ? SENSITIVE_NOTICE : null,
      declined: out.declined,
      question: next?.question ?? null,
    });
  } catch (e) {
    // Nunca el mensaje de la excepción: puede citar datos de la persona
    logger.error(
      { run_id: flowId, err: e instanceof Error ? e.name : "error" },
      "perfil: huecos falló",
    );
    return fail("server");
  } finally {
    await conn?.close();
  }
}
