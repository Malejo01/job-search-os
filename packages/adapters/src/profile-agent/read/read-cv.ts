import type { Db } from "@job-search-os/db";
import {
  normalizeCvText,
  profileAgentAllowed,
  profileAgentDailyCapUsd,
  profileAgentQuotaExempt,
  profileAgentReadsPerMonth,
  profileAgentWindows,
  type CvProposal,
  type ProfileAgentCap,
  type ProfileAgentPlan,
  type SkillTaxonomyEntry,
} from "@job-search-os/pipeline";
import { extractCvProfileReserved, type CvExtractErrorCode } from "../../cv/extract";
import { cvChatLabel, newCvConversationId } from "../../cv-chat/ids";
import { releaseCvChatReservation } from "../../cv-chat/reserve";
import type { LlmClient } from "../../llm/types";
import type { Logger } from "../../logger";
import { signProfileAgentTicket } from "../ticket";
import { recordProfileRead, reserveProfileRead } from "./reserve";

/**
 * Lectura del CV del agente de perfil (ADR-034 §1 y §6). Orquesta, en este orden y fallando cerrado en cada
 * paso: flag → ticket (sin `AUTH_SECRET` no se emite y no se gasta) → texto (el cliente no se cree) →
 * reserva con lock (cupo, topes de USD, una lectura a la vez) → `extractCvProfileReserved` (redacción,
 * inyección, modelo, normalización) → fila marcador `profile_read` solo si la propuesta pasó la
 * normalización. El modelo propone; el código verifica y decide.
 *
 * No guarda el CV, el texto ni la propuesta: en la base queda `llm_calls` (tarea, modelo, tokens, costo y
 * `label = cv:<flowId>`, sin textos) y el marcador. Logs: `user_id`, `run_id` (el `flowId`), códigos y
 * conteos; nunca el texto del CV, la salida del modelo ni el nombre del archivo.
 */
export type ReadCvErrorCode = CvExtractErrorCode | "capped" | "ticket_unavailable";

export type ReadCvError = { code: ReadCvErrorCode; cap?: ProfileAgentCap };

export type ProfileReadInput = {
  /** Siempre sale de la sesión, nunca del cliente. */
  userId: string;
  /** Email de la sesión: decide el flag `testers` y la exención de cupo. */
  email: string | null;
  /** Texto del CV tal como lo leyó el navegador (se vuelve a normalizar y redactar acá). */
  text: string;
  displayName?: string | null;
  /** Puestos que la persona ya eligió (puede estar vacío durante el onboarding). */
  roles: readonly string[];
  taxonomy: readonly SkillTaxonomyEntry[];
  roleSkillSlugs?: readonly string[];
  plan: ProfileAgentPlan;
};

export type ProfileReadDeps = {
  /** Conexión de servicio: los topes de USD son globales y ven `llm_calls` de todos. */
  db: Db;
  llm: LlmClient;
  logger: Logger;
  /** Fecha actual inyectada: el servidor no usa reloj implícito. */
  now: () => Date;
  env?: Record<string, string | undefined>;
  /** Para los tests: ids de charla fijos. */
  newFlowId?: () => string;
  timeoutMs?: number;
};

export type ProfileReadOk = {
  proposal: CvProposal;
  /** Ticket firmado de la charla que nace con esta lectura. */
  ticket: string;
  flowId: string;
};

export async function readCvForAgent(
  input: ProfileReadInput,
  deps: ProfileReadDeps,
): Promise<{ ok: true; value: ProfileReadOk } | { ok: false; error: ReadCvError }> {
  const env = deps.env ?? process.env;
  const flowId = (deps.newFlowId ?? newCvConversationId)();
  const label = cvChatLabel(flowId);
  const log = deps.logger.child({ user_id: input.userId, run_id: flowId, task: "profile_read" });
  const fail = (code: ReadCvErrorCode, cap?: ProfileAgentCap) => {
    log.warn({ code, ...(cap ? { cap } : {}) }, "profile_read_rechazado");
    return { ok: false as const, error: cap ? { code, cap } : { code } };
  };

  // 1. Flag: apagado (o sin CV_IMPORT_ENABLED=1) no hace nada más
  if (!profileAgentAllowed(env, input.email)) return fail("disabled");

  // 2. Sin ticket no hay charla: se comprueba antes de reservar y de llamar al modelo
  const now = deps.now();
  const ticket = signProfileAgentTicket(env.AUTH_SECRET, input.userId, { flowId }, now.getTime());
  if (ticket === null) return fail("ticket_unavailable");

  // 3. Texto: normalización y límites. Antes de reservar, así un texto malo no deja rastro
  const normalized = normalizeCvText(input.text);
  if (!normalized.ok) {
    return fail(normalized.error === "too_short" ? "text_too_short" : "text_too_long");
  }

  // 4. Cupo, topes de USD y una lectura a la vez, bajo lock por persona
  const windows = profileAgentWindows(now);
  let reservationId: string;
  try {
    const reservation = await reserveProfileRead(deps.db, {
      userId: input.userId,
      label,
      now,
      monthSince: windows.monthSince,
      daySince: windows.daySince,
      exempt: profileAgentQuotaExempt(env, input.email),
      readsPerMonth: profileAgentReadsPerMonth(input.plan),
      dailyCapUsd: profileAgentDailyCapUsd(env),
    });
    if (!reservation.ok) {
      return reservation.reject === "in_progress"
        ? fail("in_progress")
        : fail("capped", reservation.reject);
    }
    reservationId = reservation.reservationId;
  } catch {
    // Nunca el mensaje de la excepción: puede citar datos de la persona
    return fail("usage_unavailable");
  }

  // 5. Lectura. Solo una propuesta que pasó la normalización consume cupo (#162): el marcador se anota
  //    ANTES de soltar la reserva, así no hay una ventana en la que otra lectura de la misma persona vea
  //    la reserva suelta y el marcador todavía sin escribir. Si no se puede anotar, no se entrega:
  //    fallar cerrado es no regalar lecturas. La reserva se suelta siempre y nunca tapa el resultado.
  let read: Awaited<ReturnType<typeof extractCvProfileReserved>>;
  let marked = true;
  try {
    read = await extractCvProfileReserved(
      {
        userId: input.userId,
        text: normalized.value,
        displayName: input.displayName,
        roles: input.roles,
        taxonomy: input.taxonomy,
        roleSkillSlugs: input.roleSkillSlugs,
        label,
      },
      { llm: deps.llm, logger: deps.logger, now: deps.now, env, timeoutMs: deps.timeoutMs },
    );
    if (read.ok) {
      try {
        await recordProfileRead(deps.db, { userId: input.userId, label });
      } catch {
        marked = false;
      }
    }
  } finally {
    if (!(await releaseCvChatReservation(deps.db, reservationId))) {
      log.warn({}, "profile_read_reserva_sin_borrar");
    }
  }
  if (!read.ok) return fail(read.error.code);
  if (!marked) return fail("usage_unavailable");

  log.info(
    {
      code: "ok",
      plan: input.plan,
      work: read.value.workHistory.length,
      education: read.value.education.length,
      languages: read.value.languages.length,
      skills: read.value.skills.length,
    },
    "profile_read_ok",
  );
  return { ok: true, value: { proposal: read.value, ticket, flowId } };
}
