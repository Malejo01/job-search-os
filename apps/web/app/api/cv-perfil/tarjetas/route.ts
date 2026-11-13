import { createLogger, verifyProfileAgentTicket } from "@job-search-os/adapters";
import { PROFILE_AGENT_MAX_CARDS, profileCardDecisionSchema } from "@job-search-os/pipeline";
import { z } from "zod";
import { originAllowed } from "@/lib/cv-chat-ticket";
import { saveProfileCards } from "@/lib/profile-agent/cards-server";
import { profileAgentAllowedFor } from "@/lib/profile-agent/read-server";
import { sessionUserId } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { needsTermsAcceptance } from "@/lib/terms-status";

export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 120_000;
const NO_STORE = { "Cache-Control": "no-store" };

const ERRORS = {
  unauthorized: { status: 401, message: "Iniciá sesión para guardar tu perfil." },
  not_found: { status: 404, message: "No encontramos esta página." },
  bad_origin: { status: 403, message: "Pedido no permitido." },
  not_ready: { status: 403, message: "Antes aceptá los términos." },
  too_long: { status: 413, message: "El pedido es demasiado grande." },
  bad_request: {
    status: 400,
    message: "No entendimos el pedido. Recargá la página e intentá de nuevo.",
  },
  bad_ticket: {
    status: 409,
    message: "La charla venció. Volvé a subir tu CV; lo que ya guardaste sigue en tu perfil.",
  },
  server: { status: 500, message: "No pudimos guardar. Probá de nuevo en un rato." },
} as const;

function fail(code: keyof typeof ERRORS): Response {
  const { status, message } = ERRORS[code];
  return Response.json({ ok: false, error: code, message }, { status, headers: NO_STORE });
}

const requestSchema = z.strictObject({
  ticket: z.string().max(200),
  decisions: z.array(profileCardDecisionSchema).max(PROFILE_AGENT_MAX_CARDS),
});

/**
 * Guarda las tarjetas que la persona aceptó (ADR-034, R10-2). Orden (O7): sesión (401), flag (404), origen
 * (403), términos (403), cuerpo, ticket (409). No llama al modelo ni gasta cupo. Lo que se acepta se vuelve a
 * validar y filtrar y se guarda con RLS; lo descartado no se guarda. No hay nada del CV en la base.
 */
export async function POST(request: Request): Promise<Response> {
  const userId = await sessionUserId();
  if (!userId) return fail("unauthorized");
  if (!(await profileAgentAllowedFor(userId))) return fail("not_found");

  const allowed = [new URL(request.url).origin, siteUrl()];
  if (process.env.AUTH_URL) allowed.push(process.env.AUTH_URL);
  if (!originAllowed(request.headers.get("origin"), allowed)) return fail("bad_origin");
  if (await needsTermsAcceptance(userId)) return fail("not_ready");

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return fail("too_long");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail("bad_request");
  }
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) return fail("bad_request");

  // El ticket ata la charla a la persona y vence: sin él no se guarda
  const flow = verifyProfileAgentTicket(
    process.env.AUTH_SECRET,
    userId,
    parsed.data.ticket,
    Date.now(),
  );
  if (!flow) return fail("bad_ticket");

  const logger = createLogger({ user_id: userId, run_id: flow.flowId, trigger: "profile_cards" });
  try {
    const outcome = await saveProfileCards(userId, parsed.data.decisions);
    logger.info(
      {
        saved: outcome.saved.filter((r) => r.status === "saved" || r.status === "updated").length,
        rejected: outcome.rejected.length,
        discarded: outcome.discarded.length,
      },
      "profile cards guardadas",
    );
    return Response.json({ ok: true, ...outcome }, { headers: NO_STORE });
  } catch (e) {
    // Nunca el mensaje de la excepción: puede citar datos de la persona
    logger.error({ err: e instanceof Error ? e.name : "error" }, "profile cards falló");
    return fail("server");
  }
}
