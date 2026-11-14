import { createLogger, originAllowed } from "@job-search-os/adapters";
import {
  GUIDE_FORWARD_LINKS,
  applyGuideInput,
  buildGuideCards,
  guideCardAllowed,
  guidePrefillFromAnswers,
  sanitizeGuideAnswers,
  verifyReinforceCard,
  guideStepsLeft,
  isRoleKey,
  nextGuideStep,
  profileGuideAnswersSchema,
  profileGuideCardSchema,
  screenProfileCard,
} from "@job-search-os/pipeline";
import { z } from "zod";
import { requireProfileAgent } from "@/lib/profile-agent/access";
import {
  loadGuideContext,
  loadGuideDemand,
  primaryRole,
  roleLabels,
  roleOptions,
  saveGuideCard,
  stepView,
} from "@/lib/profile-agent/guide-server";
import { sessionUserId } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { needsTermsAcceptance } from "@/lib/terms-status";

export const dynamic = "force-dynamic";

/**
 * Guía de búsqueda del agente de perfil (ADR-034, R10-4). Sin modelo y sin gasto: no usa ticket ni topes de
 * USD (la guía «no llama al modelo y no pasa por» los topes, ADR §6). Orden: sesión (401) → flag (404) →
 * origen → términos → pedido. Las respuestas viven en el navegador (`state.guide`) y vuelven validadas con
 * esquema estricto; las tarjetas se vuelven a validar y filtrar antes de guardar. Mensajes fijos.
 */
const MAX_BODY_CHARS = 8_000;

type ErrorCode =
  | "unauthorized"
  | "not_found"
  | "bad_origin"
  | "not_ready"
  | "bad_request"
  | "too_long"
  | "invalid_answer"
  | "sensitive"
  | "injection"
  | "invalid_card"
  | "limit"
  | "server";

const MESSAGES: Record<ErrorCode, string> = {
  unauthorized: "Iniciá sesión para seguir.",
  not_found: "No encontramos esta página.",
  bad_origin: "Pedido no permitido.",
  not_ready: "Antes completá los términos.",
  bad_request: "No entendimos el pedido. Recargá la página e intentá de nuevo.",
  too_long: "El pedido es muy largo.",
  invalid_answer: "Esa respuesta no es válida. Revisala e intentá de nuevo.",
  sensitive:
    "Esa respuesta tiene datos personales que no guardamos en tu perfil. Escribí solo palabras de puestos.",
  injection: "No pudimos usar esa respuesta. Escribila con tus palabras.",
  invalid_card: "No pudimos guardar ese cambio. Podés hacerlo a mano desde tu perfil.",
  limit: "Elegiste más puestos de los que permite tu plan. Sacá alguno y probá de nuevo.",
  server: "No pudimos completar el pedido. Probá de nuevo en un rato.",
};

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  not_found: 404,
  bad_origin: 403,
  not_ready: 403,
  bad_request: 400,
  too_long: 413,
  invalid_answer: 422,
  sensitive: 422,
  injection: 422,
  invalid_card: 422,
  limit: 422,
  server: 500,
};

const NO_STORE = { "Cache-Control": "no-store" };

function fail(code: ErrorCode): Response {
  return Response.json(
    { ok: false, error: code, message: MESSAGES[code] },
    { status: STATUS[code], headers: NO_STORE },
  );
}

const requestSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("next"),
    guide: z.unknown(),
    suggestedRoles: z.array(z.string().max(40)).max(4).optional(),
  }),
  z.strictObject({
    action: z.literal("answer"),
    guide: z.unknown(),
    input: z.unknown(),
    suggestedRoles: z.array(z.string().max(40)).max(4).optional(),
  }),
  z.strictObject({
    action: z.literal("confirm"),
    card: z.unknown(),
    /** Carrera cuyo pool respalda una skill a reforzar (se valida con `isRoleKey`). */
    role: z.string().max(40).optional(),
  }),
]);

export async function POST(request: Request): Promise<Response> {
  // 1) sesión  2) flag (apagado = 404)
  const access = await requireProfileAgent(sessionUserId);
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
  const logger = createLogger({ user_id: userId, trigger: "cv_profile_guide" });

  try {
    if (req.action === "confirm") {
      const card = profileGuideCardSchema.safeParse(req.card);
      // la tarjeta vuelve del navegador: entrada no confiable, se revalida y se vuelve a filtrar
      if (!card.success || !screenProfileCard(card.data).ok || !guideCardAllowed(card.data)) {
        return fail("invalid_card");
      }
      const ctx = await loadGuideContext(userId);
      let toSave = card.data;
      if (toSave.kind === "reinforce") {
        // La evidencia que manda el navegador no se cree: se recalcula con el pool de la carrera, solo
        // pasan los `slug` que hoy propondría la guía y se guarda lo del servidor
        const role = req.role && isRoleKey(req.role) ? req.role : (ctx.profileRoles[0] ?? null);
        const trusted = verifyReinforceCard(toSave, await loadGuideDemand(role), ctx.levels);
        if (!trusted) return fail("invalid_card");
        toSave = trusted;
      }
      const saved = await saveGuideCard(userId, toSave, ctx.complete);
      if (!saved.ok) return fail(saved.reason === "limit" ? "limit" : "invalid_card");
      logger.info({ kind: card.data.kind, saved: saved.saved }, "perfil: tarjeta de la guía");
      return Response.json(
        { ok: true, saved: saved.saved, deferred: saved.deferred === true },
        { headers: NO_STORE },
      );
    }

    const guide0 = profileGuideAnswersSchema.safeParse(req.guide ?? {});
    if (!guide0.success) return fail("bad_request");
    // entrada no confiable: se vuelve a filtrar antes de usarla o devolverla (`prefill`)
    let guide = sanitizeGuideAnswers(guide0.data);
    if (req.action === "answer") {
      const next = applyGuideInput(guide, req.input);
      if (!next.ok) {
        return fail(
          next.error === "sensitive" || next.error === "injection" ? next.error : "invalid_answer",
        );
      }
      guide = next.value;
    }

    const ctx = await loadGuideContext(userId);
    const suggested = (req.suggestedRoles ?? []).filter(isRoleKey);
    const step = nextGuideStep(guide);
    const base = {
      ok: true as const,
      guide,
      left: guideStepsLeft(guide),
      // Si el onboarding no está completo, criterios y país no se escriben: precarga el formulario
      complete: ctx.complete,
      forwardLinks: GUIDE_FORWARD_LINKS,
    };
    if (step !== null) {
      return Response.json(
        {
          ...base,
          step: stepView(step),
          roleOptions: step === "roles" ? roleOptions(ctx.profileRoles, suggested) : [],
          defaults: { roles: ctx.profileRoles, country: ctx.profileCountry },
          cards: null,
        },
        { headers: NO_STORE },
      );
    }
    const demand = await loadGuideDemand(primaryRole(guide, ctx.profileRoles));
    const cards = buildGuideCards({
      answers: guide,
      language: ctx.language,
      demand,
      levels: ctx.levels,
    });
    return Response.json(
      {
        ...base,
        step: null,
        cards,
        roleLabels: roleLabels(guide.roles ?? []),
        prefill: guidePrefillFromAnswers(guide),
      },
      { headers: NO_STORE },
    );
  } catch (e) {
    // Nunca el mensaje de la excepción: puede citar datos de la persona
    logger.error({ err: e instanceof Error ? e.name : "error" }, "perfil: guía falló");
    return fail("server");
  }
}
