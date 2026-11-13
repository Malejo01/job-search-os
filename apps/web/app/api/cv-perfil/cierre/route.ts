import {
  PROFILE_AGENT_MAX_WRITE_ATTEMPTS,
  buildProfileCloseWriteInput,
  checkProfileWrittenEntries,
  profileAgentWriteNotice,
  profileSummaryPrefill,
  type ProfileAgentWriteReject,
  type ProfileWrittenEntry,
} from "@job-search-os/pipeline";
import {
  createLogger,
  recordProfileAgentWriteFailure,
  releaseCvChatReservation,
  reserveProfileAgentWrite,
  runProfileAgentWrite,
  verifyProfileAgentTicket,
} from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import { z } from "zod";
import { originAllowed } from "@/lib/cv-chat-ticket";
import { serviceLlm } from "@/lib/llm-service";
import { sessionUserId } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { needsTermsAcceptance } from "@/lib/terms-status";
import { getUserPlan } from "@/lib/user-plan";
import { requireProfileAgent } from "@/lib/profile-agent/access";
import {
  buildCloseDocument,
  loadProfileCloseFacts,
  saveWrittenBullets,
  skillCatalogNames,
} from "@/lib/profile-agent/close-server";

export const dynamic = "force-dynamic";

/**
 * Cierre del agente de perfil (ADR-034 §1 y §9, R10-5): redacta el CV con `cv_write` y el verificador de
 * ADR-026 y, con el clic de la persona, guarda las viñetas. Orden (ADR §9, O7): 1) sesión (401),
 * 2) flag (404, sin tocar el modelo), 3) ticket (409), 4) tope (mensaje fijo). Nada del CV ni de la charla
 * se guarda; el modelo propone y el código decide.
 */

const MAX_BODY_CHARS = 20_000;

type ErrorCode =
  | "unauthorized"
  | "not_found"
  | "bad_origin"
  | "bad_request"
  | "too_long"
  | "not_ready"
  | "bad_ticket"
  | "server";

const MESSAGES: Record<ErrorCode, string> = {
  unauthorized: "Iniciá sesión para armar tu CV.",
  not_found: "No encontramos esta página.",
  bad_origin: "Pedido no permitido.",
  bad_request: "No entendimos el pedido. Recargá la página e intentá de nuevo.",
  too_long: "El pedido es muy largo.",
  not_ready: "Antes aceptá los términos vigentes.",
  bad_ticket: "La charla venció. Empezá de nuevo; lo que ya confirmaste en tu perfil sigue ahí.",
  server: "No pudimos completar el pedido. Probá de nuevo en un rato.",
};

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  not_found: 404,
  bad_origin: 403,
  bad_request: 400,
  too_long: 413,
  not_ready: 403,
  bad_ticket: 409,
  server: 500,
};

const NO_STORE = { "Cache-Control": "no-store" };

function fail(code: ErrorCode): Response {
  return Response.json(
    { ok: false, error: code, message: MESSAGES[code] },
    { status: STATUS[code], headers: NO_STORE },
  );
}

function capped(reject: ProfileAgentWriteReject): Response {
  const notice = profileAgentWriteNotice(reject);
  return Response.json(
    { ok: false, error: reject === "already_written" ? "already_written" : "capped", ...notice },
    { status: reject === "already_written" ? 409 : 429, headers: NO_STORE },
  );
}

const requestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("write"), ticket: z.string(), lang: z.enum(["es", "en"]) }),
  z.strictObject({ action: z.literal("confirm"), ticket: z.string(), entries: z.unknown() }),
]);

export async function POST(request: Request): Promise<Response> {
  // 1) sesión
  // 2) flag: apagado, 404 como cualquier ruta que no existe
  const access = await requireProfileAgent(sessionUserId);
  if (!access.ok) return fail(access.stage === "session" ? "unauthorized" : "not_found");
  const userId = access.userId;

  const allowed = [new URL(request.url).origin, siteUrl()];
  if (process.env.AUTH_URL) allowed.push(process.env.AUTH_URL);
  if (!originAllowed(request.headers.get("origin"), allowed)) return fail("bad_origin");
  // El onboarding todavía no está completo en este flujo; los términos sí tienen que estar aceptados
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

  // 3) ticket firmado: solo lleva el id de la charla
  const now = Date.now();
  const ticket = verifyProfileAgentTicket(process.env.AUTH_SECRET, userId, req.ticket, now);
  if (!ticket) return fail("bad_ticket");

  const logger = createLogger({ user_id: userId, trigger: "profile_agent_close" });
  let conn = null as ReturnType<typeof createDb> | null;
  try {
    // Confirmar no llama al modelo: no hay tope que medir
    if (req.action === "confirm") {
      const checked = checkProfileWrittenEntries(req.entries);
      if (!checked.ok) return fail("bad_request");
      const saved = await saveWrittenBullets(userId, checked.entries);
      logger.info(
        { run_id: ticket.flowId, updated: saved.updated, dropped: checked.dropped },
        "agente de perfil: viñetas confirmadas",
      );
      return Response.json({ ok: true, ...saved, dropped: checked.dropped }, { headers: NO_STORE });
    }

    // write: redactar, verificar y armar la vista previa. No guarda nada.
    conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
    const db = conn.db;
    const facts = await loadProfileCloseFacts(userId, req.lang);
    const built = buildProfileCloseWriteInput(facts);
    // 4) tope: reserva con lock por persona (una redacción por charla, cupo mensual y USD)
    const plan = await getUserPlan(userId, new Date(now));
    const slot = await reserveProfileAgentWrite(db, {
      userId,
      flowId: ticket.flowId,
      now: new Date(now),
      planCvPerMonth: plan.plan.limits.cvReadsPerMonth,
      env: process.env,
      callsModel: built.hasWork,
    });
    if (!slot.ok) return capped(slot.reject);

    let written = {
      history: built.input.history,
      summary: null as string | null,
      usedModel: false,
      // R11-2: la redacción falló de verdad: la persona puede reintentar una vez sin perder la charla
      retry: false,
    };
    if (built.hasWork) {
      const llm = serviceLlm(db, logger);
      let r;
      try {
        r = await runProfileAgentWrite(
          { llm },
          {
            userId,
            flowId: ticket.flowId,
            input: built.input,
            knownTerms: await skillCatalogNames(db),
          },
        );
      } catch (e) {
        // Si lanzó antes de que el cliente LLM registrara su fila, el intento igual cuenta (una redacción
        // por charla y gasto estimado): se anota una fila fallida antes de soltar la reserva
        await recordProfileAgentWriteFailure(db, { userId, flowId: ticket.flowId }).catch(() => {});
        throw e;
      } finally {
        if (!(await releaseCvChatReservation(db, slot.reservationId))) {
          logger.warn({ run_id: ticket.flowId }, "agente de perfil: no se pudo borrar la reserva");
        }
      }
      if (r.ok) {
        written = {
          history: r.value.history,
          summary: r.value.summary,
          usedModel: true,
          retry: false,
        };
        logger.info(
          { run_id: ticket.flowId, ...r.value.stats },
          "agente de perfil: redacción verificada",
        );
      } else {
        // Sin redacción, el CV sale con el texto de la persona (igual que el chat de CV); y un solo reintento
        // Con este intento ya contado, queda lugar solo si era el primero (`PROFILE_AGENT_MAX_WRITE_ATTEMPTS`)
        written.retry = slot.measures.writesInConversation + 1 < PROFILE_AGENT_MAX_WRITE_ATTEMPTS;
        logger.warn(
          { run_id: ticket.flowId, llm_error: r.error.kind },
          "agente de perfil: sin redacción, va el texto de la persona",
        );
      }
    }
    // Las viñetas redactadas, por id de fila; las entradas sin id (no pasaron el filtro) no se tocan
    const entries: ProfileWrittenEntry[] = [];
    written.history.forEach((h, i) => {
      const id = built.historyIds[i];
      if (id && h.kind === "trabajo" && h.bullets.length > 0) {
        entries.push({ id, bullets: [...h.bullets] });
      }
    });
    // Defensa: lo que sale del modelo pasa la misma revisión que lo que vuelve del navegador
    const screened = checkProfileWrittenEntries(entries);
    const safeEntries = screened.ok ? screened.entries : [];
    // El resumen que sale pasa el mismo filtro de sensibles e inyección que el que precarga el formulario
    const safeSummary = profileSummaryPrefill(written.summary);
    const doc = await buildCloseDocument(userId, {
      lang: req.lang,
      written: safeEntries,
      summary: safeSummary,
    });
    if (!doc) return fail("server");
    return Response.json(
      {
        ok: true,
        doc,
        entries: safeEntries,
        summary: safeSummary,
        usedModel: written.usedModel,
        retry: written.retry,
      },
      { headers: NO_STORE },
    );
  } catch (e) {
    // Nunca el mensaje de la excepción: puede citar datos de la persona
    logger.error(
      { run_id: ticket.flowId, err: e instanceof Error ? e.name : "error" },
      "agente de perfil: el cierre falló",
    );
    return fail("server");
  } finally {
    await conn?.close();
  }
}
