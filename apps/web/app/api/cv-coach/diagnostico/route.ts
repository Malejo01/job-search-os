import {
  createLogger,
  originAllowed,
  runCvReview,
  signProfileAgentTicket,
  verifyProfileAgentTicket,
  type CvCoachReject,
} from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import { cvCoachCapNotice, profileAgentCapNotice } from "@job-search-os/pipeline";
import { z } from "zod";
import { requireCvCoach } from "@/lib/cv-coach/access";
import { cvCoachBefore, loadCvCoachContext } from "@/lib/cv-coach/context";
import { serviceLlm } from "@/lib/llm-service";
import { bodyBytesForChars, readBodyLimited } from "@/lib/read-body-limited";
import { sessionUserId } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { needsTermsAcceptance } from "@/lib/terms-status";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Diagnóstico del coach de CV (ADR-038 §4, R12-10). Orden de los chequeos (O7 de ADR-034): sesión (401, sin
 * tocar la base ni el modelo) → flag `cvCoachAllowed` (404) → ticket del agente de perfil (409) → topes
 * (429, mensaje fijo, dentro de `runCvReview`). Lo confirmado se lee acá con RLS: el navegador solo manda el
 * ticket. Devuelve la lista firmada (el navegador la guarda en `jso:coach:issues`), los textos de plantilla y
 * la foto «antes». No se guarda nada: ni el CV, ni el diagnóstico, ni la lista. Nunca se devuelve el texto
 * de una excepción ni del modelo.
 */
const MAX_BODY_CHARS = 2_000;

type ErrorCode =
  | "unauthorized"
  | "not_found"
  | "bad_origin"
  | "not_ready"
  | "bad_request"
  | "too_long"
  | "bad_ticket"
  | "llm_unavailable"
  | "server";

const MESSAGES: Record<ErrorCode, string> = {
  unauthorized: "Iniciá sesión para seguir.",
  not_found: "No encontramos esta página.",
  bad_origin: "Pedido no permitido.",
  not_ready: "Antes completá los términos.",
  bad_request: "No entendimos el pedido. Recargá la página e intentá de nuevo.",
  too_long: "El pedido es demasiado grande. Recargá la página e intentá de nuevo.",
  bad_ticket:
    "La charla venció. Volvé a empezar la lectura de tu CV; lo que ya confirmaste sigue en tu perfil.",
  llm_unavailable:
    "No pudimos revisar tu CV ahora. Probá de nuevo en un rato o armá tu CV con lo que ya confirmaste.",
  server: "No pudimos completar el pedido. Probá de nuevo en un rato.",
};

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  not_found: 404,
  bad_origin: 403,
  not_ready: 403,
  bad_request: 400,
  too_long: 413,
  bad_ticket: 409,
  llm_unavailable: 503,
  server: 500,
};

const NO_STORE = { "Cache-Control": "no-store" };

function fail(code: ErrorCode): Response {
  return Response.json(
    { ok: false, error: code, message: MESSAGES[code] },
    { status: STATUS[code], headers: NO_STORE },
  );
}

/** Los topes propios del coach llevan al cierre; los del agente (persona-día, global), a las pantallas. */
function capped(reject: CvCoachReject): Response {
  const notice =
    reject === "turnos" || reject === "diagnosticos" || reject === "charla"
      ? cvCoachCapNotice(reject)
      : profileAgentCapNotice(reject);
  return Response.json(
    { ok: false, error: "capped", cap: reject, ...notice },
    { status: 429, headers: NO_STORE },
  );
}

const requestSchema = z.strictObject({ ticket: z.string().max(300) });

export async function POST(request: Request): Promise<Response> {
  // 1) sesión → 2) flag (apagado = 404, sin tocar el modelo)
  const access = await requireCvCoach(sessionUserId);
  if (!access.ok) return fail(access.stage === "session" ? "unauthorized" : "not_found");
  const userId = access.userId;
  const allowed = [new URL(request.url).origin, siteUrl()];
  if (process.env.AUTH_URL) allowed.push(process.env.AUTH_URL);
  if (!originAllowed(request.headers.get("origin"), allowed)) return fail("bad_origin");
  if (await needsTermsAcceptance(userId)) return fail("not_ready");

  const limited = await readBodyLimited(request, bodyBytesForChars(MAX_BODY_CHARS));
  if (!limited.ok) return fail("too_long");
  const text = limited.text;
  if (text.length > MAX_BODY_CHARS) return fail("bad_request");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail("bad_request");
  }
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) return fail("bad_request");

  // 3) ticket del agente de perfil: el coach no tiene ticket propio
  const now = Date.now();
  const secret = process.env.AUTH_SECRET;
  const ticket = verifyProfileAgentTicket(secret, userId, parsed.data.ticket, now);
  if (!ticket) return fail("bad_ticket");
  const flowId = ticket.flowId;
  const logger = createLogger({ user_id: userId, run_id: flowId, trigger: "cv_coach_review" });

  let conn = null as ReturnType<typeof createDb> | null;
  try {
    const { ctx } = await loadCvCoachContext(userId);
    conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
    const db = conn.db;
    // 4) topes y modelo
    const out = await runCvReview(
      { userId, flowId, ctx },
      { db, llm: serviceLlm(db, logger), logger, now: () => new Date(now) },
    );
    if (!out.ok) {
      if (out.error.code === "capped" && out.error.cap) return capped(out.error.cap);
      if (out.error.code === "timeout" || out.error.code === "llm_failed") {
        return fail("llm_unavailable");
      }
      return fail("server");
    }
    // El ticket se renueva: el coach sigue la misma charla (mismo `flowId`) con dos horas más
    const renewed = signProfileAgentTicket(secret, userId, { flowId }, Date.now());
    if (!renewed) return fail("server");
    return Response.json(
      {
        ok: true,
        ticket: renewed,
        heading: out.value.heading,
        issues: out.value.signed,
        views: out.value.views,
        before: cvCoachBefore(flowId, ctx.items),
        usedModel: out.value.usedModel,
      },
      { headers: NO_STORE },
    );
  } catch {
    // Nunca el mensaje de la excepción: puede citar datos de la persona
    logger.error({}, "coach: diagnóstico falló");
    return fail("server");
  } finally {
    await conn?.close();
  }
}
