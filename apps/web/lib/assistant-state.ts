import { schema as s } from "@job-search-os/db";
import {
  assistantStep,
  GMAIL_FORWARDING_PARSER,
  isLegacyInboundAddress,
  type AssistantFacts,
  type AssistantStep,
} from "@job-search-os/pipeline";
import { and, eq, gt, isNotNull, or } from "drizzle-orm";
import { cookies } from "next/headers";
import { withUser } from "./db";
import { pendingGmailConfirmation, type GmailConfirmation } from "./inbox-list";

/**
 * Estado del asistente de reenvío (ronda 26), todo derivado de lo que ya hay en la base y sin
 * migración. «Ya importé los filtros» no deja rastro en Gmail ni en la base: se guarda en una cookie
 * `httpOnly` de un año. Es solo UX; si se pierde, la persona vuelve a ver el paso de los filtros.
 */
export const FILTERS_COOKIE = "jso_filtros_ok";
export const FILTERS_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type AssistantState = {
  step: AssistantStep;
  facts: AssistantFacts;
  /** El pedido de confirmación de Gmail pendiente, con su link (que abre el navegador, no el servidor). */
  confirmation: GmailConfirmation | null;
};

/**
 * La cookie lleva el id del usuario (no `1`): en un navegador compartido, el reconocimiento de una
 * cuenta no vale para otra.
 */
export async function filtersAcknowledged(userId: string): Promise<boolean> {
  const jar = await cookies();
  return jar.get(FILTERS_COOKIE)?.value === userId;
}

export async function assistantState(
  userId: string,
  address: string | null,
): Promise<AssistantState> {
  const [confirmation, db, acknowledged] = await Promise.all([
    pendingGmailConfirmation(userId),
    withUser(userId, async (tx) => {
      const [seen] = await tx
        .select({ id: s.inboundEmails.id })
        .from(s.inboundEmails)
        .where(
          and(
            eq(s.inboundEmails.parser, GMAIL_FORWARDING_PARSER),
            // Descartado desde la bandeja también cuenta: si no, el asistente volvería al paso 1
            or(isNotNull(s.inboundEmails.seenAt), isNotNull(s.inboundEmails.dismissedAt)),
          ),
        )
        .limit(1);
      const [alert] = await tx
        .select({ id: s.inboundEmails.id })
        .from(s.inboundEmails)
        .where(gt(s.inboundEmails.jobsExtracted, 0))
        .limit(1);
      return { seen: Boolean(seen), alert: Boolean(alert) };
    }),
    filtersAcknowledged(userId),
  ]);
  const facts: AssistantFacts = {
    // Sin dirección no hay formato viejo: el paso 1 la pide
    legacyAddress:
      address !== null &&
      (isLegacyInboundAddress(address, userId) || !/^u_[a-z2-7]{20}@/.test(address)),
    gmailConfirmationPending: confirmation !== null,
    gmailConfirmationSeen: db.seen,
    filtersAcknowledged: acknowledged,
    firstAlertReceived: db.alert,
  };
  return { step: assistantStep(facts), facts, confirmation };
}
